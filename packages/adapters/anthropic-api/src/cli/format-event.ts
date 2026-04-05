/**
 * Print a stdout event line from the anthropic_api adapter to the console.
 */
export function printAnthropicApiStreamEvent(
  raw: string,
  _debug: boolean,
): void {
  const line = raw.trim();
  if (!line) return;

  if (line.startsWith("[anthropic-api]")) {
    console.log(line);
    return;
  }

  console.log(line);
}
