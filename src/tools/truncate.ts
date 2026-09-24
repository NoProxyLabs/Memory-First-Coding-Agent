const DEFAULT_MAX_CHARS = 8000;

export function truncateOutput(text: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... output truncated, ${omitted} more characters omitted ...]`;
}