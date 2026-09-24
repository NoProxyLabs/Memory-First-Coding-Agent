import type {
  LLMProvider,
  Message,
  ToolDefinition,
  ModelResponse,
  ToolCall,
  StopReason,
} from "../provider.js";
import { withRetry } from "../retry.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
}

interface GroqResponse {
  choices: GroqChoice[];
}

function toGroqStopReason(finishReason: string): StopReason {
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  return "end_turn";
}

export class GroqProvider implements LLMProvider {
  name = "groq";

  constructor(
    private apiKey: string,
    private model: string = "qwen/qwen3.8-27b"
  ) {}

  async complete(
    messages: Message[],
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): Promise<ModelResponse> {
    return withRetry(() => this.completeOnce(messages, tools, signal), {
      signal,
      onRetry: (attempt, delayMs, err) => {
        const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
        console.log(`  [retry ${attempt}] waiting ${(delayMs / 1000).toFixed(1)}s — ${reason}`);
      },
    });
  }

  private async completeOnce(
    messages: Message[],
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): Promise<ModelResponse> {
    const body = {
      model: this.model,
      messages: messages.map((m) => {
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            })),
          };
        }
        if (m.role === "tool") {
          return {
            role: "tool",
            tool_call_id: m.toolCallId,
            name: m.toolCallName,
            content: m.content,
          };
        }
        return { role: m.role, content: m.content };
      }),
      tools: tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
    };

    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as GroqResponse;
    const choice = data.choices[0];

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      message: {
        role: "assistant",
        content: choice.message.content ?? "",
      },
      toolCalls,
      stopReason: toGroqStopReason(choice.finish_reason),
    };
  }
}