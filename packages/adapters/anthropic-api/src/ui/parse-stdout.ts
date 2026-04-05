import type { TranscriptEntry } from "@paperclipai/adapter-utils";

/**
 * Parse a stdout line from the anthropic_api adapter into transcript entries.
 *
 * Since this adapter outputs plain text (the model's response), we emit it
 * as an assistant transcript entry. Any line prefixed with [anthropic-api]
 * is treated as a system message.
 */
export function parseAnthropicApiStdoutLine(
  line: string,
  ts: string,
): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[anthropic-api]")) {
    return [
      {
        kind: "system",
        ts,
        text: trimmed.replace(/^\[anthropic-api\]\s*/, ""),
      },
    ];
  }

  return [{ kind: "assistant", ts, text: line }];
}
