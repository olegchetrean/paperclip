import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

function resolveEnvValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return String((raw as Record<string, unknown>).value ?? "");
  }
  return "";
}

function summarizeStatus(
  checks: AdapterEnvironmentCheck[],
): AdapterEnvironmentTestResult["status"] {
  if (checks.some((c) => c.level === "error")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

function buildMessagesUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/v1")) return `${clean}/messages`;
  return `${clean}/v1/messages`;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const envConfig = parseObject(config.env);

  const apiKey =
    asString(config.apiKey, "") ||
    resolveEnvValue(envConfig.ANTHROPIC_API_KEY) ||
    "";
  const baseUrl =
    asString(config.baseUrl, "") ||
    resolveEnvValue(envConfig.ANTHROPIC_BASE_URL) ||
    "https://api.anthropic.com";
  const model = asString(config.model, "claude-sonnet-4-6");

  // Check: API key
  if (apiKey) {
    checks.push({
      code: "anthropic_api_key_present",
      level: "info",
      message: `API key configured: ${apiKey.slice(0, 8)}...`,
    });
  } else {
    checks.push({
      code: "anthropic_api_key_missing",
      level: "error",
      message: "ANTHROPIC_API_KEY is not set.",
      hint: "Set apiKey in adapter config or ANTHROPIC_API_KEY in env bindings.",
    });
  }

  // Check: base URL
  checks.push({
    code: "anthropic_api_base_url",
    level: "info",
    message: `Base URL: ${baseUrl}`,
  });

  // Check: model
  checks.push({
    code: "anthropic_api_model",
    level: "info",
    message: `Model: ${model}`,
  });

  // Live probe (only if we have a key)
  if (apiKey) {
    try {
      const url = buildMessagesUrl(baseUrl);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Respond with the word hello." }],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        checks.push({
          code: "anthropic_api_probe_ok",
          level: "info",
          message: "Live API probe succeeded.",
        });
      } else {
        const body = await response.text();
        checks.push({
          code: "anthropic_api_probe_failed",
          level: "warn",
          message: `API probe returned ${response.status}: ${body.slice(0, 200)}`,
          hint: "Verify API key, model, and base URL.",
        });
      }
    } catch (err) {
      checks.push({
        code: "anthropic_api_probe_error",
        level: "warn",
        message: `API probe error: ${err instanceof Error ? err.message : String(err)}`,
        hint: "Verify network connectivity and base URL from the Paperclip server.",
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
