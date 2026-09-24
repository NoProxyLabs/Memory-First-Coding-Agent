import type { LLMProvider, Message, ToolDefinition } from "./provider.js";
import type { Tool } from "../tools/types.js";
import { maybeCompact } from "../context/compaction.js";
import type { ContextBudget } from "../context/builder.js";
import { truncateOutput } from "../tools/truncate.js";

export interface AgentLoopOptions {
  provider: LLMProvider;
  tools: Tool[];
  systemPrompt: string;
  userMessage: string;
  priorMessages?: Message[]; // pass a session's stored history to resume it instead of starting fresh
  maxIterations?: number; // safety cap — without this, a confused model can loop forever
  onToolCall?: (name: string, input: Record<string, unknown>, result: string) => void;
  onMessage?: (message: Message) => void; // fired for every new message added this run — the hook a session store persists from
  contextBudget?: ContextBudget; // omit to disable compaction entirely
  onCompact?: (beforeCount: number, afterCount: number) => void;
  signal?: AbortSignal; // Ctrl+C wired through main.ts cancels via this
  // Called once per turn with the triggering user message; return
  // formatted memory text to inject, or null for none. Injected fresh
  // into every model call this turn but NEVER added to `messages` itself
  // — it must not get persisted via onMessage, since relevance is
  // per-turn and a stale memory snapshot baked permanently into history
  // would just be noise on every future replay of this session.
  retrieveContext?: (userMessage: string) => Promise<string | null>;
}

export interface AgentLoopResult {
  finalMessage: string;
  messages: Message[]; // full history, prior + this run's new turns
}

// This generalizes what test-tools.ts did by hand: instead of one fixed
// exchange (call -> execute -> respond), keep looping — call, execute,
// feed back, call again — until the model returns "end_turn" or we hit the
// safety cap. This is the actual shape every real coding agent uses; the
// harness's whole job from here is to make what goes into buildContext()
// (still just raw messages for now) smarter over time.

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    provider,
    tools,
    systemPrompt,
    userMessage,
    priorMessages = [],
    maxIterations = 10,
    onToolCall,
    onMessage,
    contextBudget,
    onCompact,
    signal,
    retrieveContext,
  } = options;
  const toolDefs: ToolDefinition[] = tools.map((t) => t.definition);

  // Resuming a session skips re-adding the system prompt — it's already the
  // first message in priorMessages. Starting fresh needs it.
  const messages: Message[] =
    priorMessages.length > 0
      ? [...priorMessages]
      : [{ role: "system", content: systemPrompt }];

  const userMsg: Message = { role: "user", content: userMessage };
  messages.push(userMsg);
  onMessage?.(userMsg);

  // Computed once per turn from the triggering user message — every
  // tool-call iteration within this same turn reuses it, rather than
  // re-querying retrieval on every loop iteration.
  const memoryContext = retrieveContext ? await retrieveContext(userMessage) : null;

  for (let i = 0; i < maxIterations; i++) {
    if (contextBudget) {
      const before = messages.length;
      const result = await maybeCompact(provider, messages, contextBudget, signal);
      if (result.compacted) {
        messages.length = 0;
        messages.push(...result.messages);
        onCompact?.(before, messages.length);
      }
    }

    // callMessages is what actually goes to the model — memoryContext gets
    // spliced in here only, right after the true system prompt, so it's
    // fresh every call but never touches the persisted `messages` array.
    const callMessages: Message[] = memoryContext
      ? [messages[0], { role: "system", content: memoryContext }, ...messages.slice(1)]
      : messages;

    const response = await provider.complete(callMessages, toolDefs, signal);

    if (response.stopReason === "end_turn" || response.toolCalls.length === 0) {
      const finalMsg: Message = { role: "assistant", content: response.message.content };
      messages.push(finalMsg);
      onMessage?.(finalMsg);
      return { finalMessage: response.message.content, messages };
    }

    // Record this assistant turn (with its tool_calls) before the responses,
    // same protocol requirement we hit and fixed in test-tools.ts.
    const assistantMsg: Message = {
      role: "assistant",
      content: response.message.content,
      toolCalls: response.toolCalls,
    };
    messages.push(assistantMsg);
    onMessage?.(assistantMsg);

    for (const call of response.toolCalls) {
      const tool = tools.find((t) => t.definition.name === call.name);
      const rawResult = tool
        ? await tool.execute(call.input)
        : `Error: no tool registered named "${call.name}"`;
      const result = truncateOutput(rawResult);

      onToolCall?.(call.name, call.input, result);

      const toolMsg: Message = {
        role: "tool",
        content: result,
        toolCallId: call.id,
        toolCallName: call.name,
      };
      messages.push(toolMsg);
      onMessage?.(toolMsg);
    }
  }

  return {
    finalMessage: "Stopped: reached max iterations without the model finishing on its own.",
    messages,
  };
}