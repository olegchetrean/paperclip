import type { CreateConfigValues } from "@paperclipai/adapter-utils";

/**
 * Build the adapter config object from the create-agent form values.
 */
export function buildAnthropicApiConfig(
  v: CreateConfigValues,
): Record<string, unknown> {
  const ac: Record<string, unknown> = {};

  // URL is used for baseUrl in the form
  if (v.url) ac.baseUrl = v.url;

  // Model
  if (v.model) ac.model = v.model;

  // Bootstrap prompt is used as systemPrompt
  if (v.bootstrapPrompt) ac.systemPrompt = v.bootstrapPrompt;

  // Env vars may carry ANTHROPIC_API_KEY
  if (v.envVars) {
    const env: Record<string, string> = {};
    for (const line of v.envVars.split("\n")) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        if (key) env[key] = val;
      }
    }
    if (Object.keys(env).length > 0) ac.env = env;
  }

  ac.maxTokens = 16384;
  ac.temperature = 1.0;
  ac.timeoutSec = 300;

  return ac;
}
