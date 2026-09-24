// The contract every LLM provider (Groq, OpenRouter, Gemini...) must implement.
// The agent loop only ever talks to this interface — it never knows which
// actual provider is behind it. That's what makes swapping providers (or
// running an eval across providers) a one-line change later.

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string; // for role: "tool" — which call this responds to
  toolCallName?: string; // for role: "tool" — the tool's name; Groq requires this on the response, not just the id
  toolCalls?: ToolCall[]; // for role: "assistant" — the calls this turn made, so history stays valid on the next request
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema, passed to the provider
}

// "stopReason" is a discriminated union in spirit: the agent loop branches on
// this value to decide whether to keep looping or stop. TypeScript won't
// force you to handle every case here (that needs a real discriminated union
// with a payload per case), but even this plain string-literal union means
// a typo like "tooluse" fails to compile instead of failing silently at 2am.
export type StopReason = "tool_use" | "end_turn" | "max_tokens";

export interface ModelResponse {
  message: Message;
  toolCalls: ToolCall[];
  stopReason: StopReason;
}

export interface LLMProvider {
  name: string;
  complete(messages: Message[], tools: ToolDefinition[], signal?: AbortSignal): Promise<ModelResponse>;
}