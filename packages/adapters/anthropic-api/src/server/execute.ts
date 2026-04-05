import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  parseObject,
  renderTemplate,
  joinPromptSections,
} from "@paperclipai/adapter-utils/server-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveEnvValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return String((raw as Record<string, unknown>).value ?? "");
  }
  return "";
}

function buildMessagesUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/v1")) return `${clean}/messages`;
  return `${clean}/v1/messages`;
}

function resolveProviderFromUrl(baseUrl: string): string {
  if (baseUrl.includes("azure") || baseUrl.includes("services.ai.azure.com")) return "azure";
  if (baseUrl.includes("bedrock") || baseUrl.includes("amazonaws")) return "bedrock";
  return "anthropic";
}

// ---------------------------------------------------------------------------
// Cost calculation (cents per 1M tokens)
// ---------------------------------------------------------------------------

const PRICING: Record<string, { input: number; output: number; cached: number }> = {
  "claude-opus-4-6":            { input: 1500, output: 7500, cached: 150 },
  "claude-sonnet-4-6":          { input: 300,  output: 1500, cached: 30 },
  "claude-haiku-4-5-20251001":  { input: 80,   output: 400,  cached: 8 },
};

function calculateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  const cents =
    (inputTokens * p.input + outputTokens * p.output + cachedTokens * p.cached) / 1_000_000;
  return Math.round(cents * 100) / 10_000;
}

// ---------------------------------------------------------------------------
// Tool definitions for Claude
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "Read",
    description: "Read a file from disk. Returns the file contents.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string" as const, description: "Absolute path to the file to read" },
        offset: { type: "number" as const, description: "Line number to start from (0-based)" },
        limit: { type: "number" as const, description: "Max lines to read" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Write",
    description: "Write content to a file (creates or overwrites).",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string" as const, description: "Absolute path to the file" },
        content: { type: "string" as const, description: "Content to write" },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "Bash",
    description: "Execute a bash command and return stdout+stderr. Timeout 30s.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "The bash command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern. Returns newline-separated file paths.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" as const, description: "Glob pattern like **/*.ts" },
        path: { type: "string" as const, description: "Directory to search in" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description: "Search file contents with regex. Returns matching file paths or lines.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" as const, description: "Regex pattern to search for" },
        path: { type: "string" as const, description: "File or directory to search in" },
        glob: { type: "string" as const, description: "Glob filter for files" },
      },
      required: ["pattern"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

function executeTool(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): { result: string; isError: boolean } {
  try {
    switch (name) {
      case "Read": {
        const filePath = String(input.file_path ?? "");
        if (!filePath) return { result: "Error: file_path is required", isError: true };
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
        if (!fs.existsSync(fullPath)) return { result: `Error: File not found: ${fullPath}`, isError: true };
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const offset = Number(input.offset ?? 0);
        const limit = Number(input.limit ?? 2000);
        const sliced = lines.slice(offset, offset + limit);
        return { result: sliced.map((l, i) => `${offset + i + 1}\t${l}`).join("\n"), isError: false };
      }

      case "Write": {
        const filePath = String(input.file_path ?? "");
        const content = String(input.content ?? "");
        if (!filePath) return { result: "Error: file_path is required", isError: true };
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content, "utf-8");
        return { result: `File written: ${fullPath}`, isError: false };
      }

      case "Bash": {
        const command = String(input.command ?? "");
        if (!command) return { result: "Error: command is required", isError: true };
        try {
          const output = execSync(command, {
            cwd,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { result: output.slice(0, 50_000), isError: false };
        } catch (err) {
          const execErr = err as { stdout?: string; stderr?: string; status?: number };
          const out = (execErr.stdout ?? "") + (execErr.stderr ?? "");
          return { result: out.slice(0, 50_000) || `Command failed with exit code ${execErr.status}`, isError: true };
        }
      }

      case "Glob": {
        const pattern = String(input.pattern ?? "");
        const searchPath = String(input.path ?? cwd);
        if (!pattern) return { result: "Error: pattern is required", isError: true };
        try {
          const output = execSync(
            `find ${JSON.stringify(searchPath)} -type f -name ${JSON.stringify(pattern)} 2>/dev/null | head -100`,
            { cwd, timeout: 10_000, encoding: "utf-8" },
          );
          return { result: output.trim() || "(no matches)", isError: false };
        } catch {
          return { result: "(no matches)", isError: false };
        }
      }

      case "Grep": {
        const pattern = String(input.pattern ?? "");
        const searchPath = String(input.path ?? cwd);
        const globFilter = input.glob ? `--glob ${JSON.stringify(String(input.glob))}` : "";
        if (!pattern) return { result: "Error: pattern is required", isError: true };
        try {
          const output = execSync(
            `rg --no-heading -n ${JSON.stringify(pattern)} ${globFilter} ${JSON.stringify(searchPath)} 2>/dev/null | head -200`,
            { cwd, timeout: 10_000, encoding: "utf-8" },
          );
          return { result: output.trim() || "(no matches)", isError: false };
        } catch {
          return { result: "(no matches)", isError: false };
        }
      }

      default:
        return { result: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { result: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

// ---------------------------------------------------------------------------
// Agentic message types
// ---------------------------------------------------------------------------

interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type ContentBlock = TextBlock | ToolUseBlock;

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlock[];
}

interface ApiResponse {
  content: ContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  stop_reason?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Execute — agentic loop with tool use
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context } = ctx;
  const startTime = Date.now();

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
  const systemPrompt = asString(config.systemPrompt, "");
  const maxTokens = asNumber(config.maxTokens, 16384);
  const temperature = asNumber(config.temperature, 1.0);
  const timeoutSec = asNumber(config.timeoutSec, 600);
  const maxTurns = asNumber(config.maxTurns, 50);
  const cwd = asString(config.cwd, process.cwd());

  // Build prompt
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Complete the assigned Paperclip task.",
  );
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const prompt = joinPromptSections([sessionHandoffNote, renderedPrompt]) || "No task assigned.";

  if (!apiKey) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "ANTHROPIC_API_KEY is required but not set in adapter config.",
      errorCode: "missing_api_key",
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      costUsd: 0,
      billingType: "api",
      provider: "anthropic",
      biller: resolveProviderFromUrl(baseUrl),
      model,
    };
  }

  await ctx.onMeta?.({
    adapterType: "anthropic_api",
    command: "fetch",
    cwd,
    prompt,
    context: { model, baseUrl: baseUrl.replace(/\/+$/, ""), maxTokens, maxTurns },
  });

  const url = buildMessagesUrl(baseUrl);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let exitCode = 0;
  let errorMessage: string | null = null;
  let errorCode: string | null = null;
  let lastTextOutput = "";

  // Conversation messages
  const messages: Message[] = [
    { role: "user", content: prompt },
  ];

  // Agentic loop
  for (let turn = 0; turn < maxTurns; turn++) {
    let response: ApiResponse;

    try {
      const body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        tools: TOOLS,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!fetchResponse.ok) {
        const errorBody = await fetchResponse.text();
        errorMessage = `API error ${fetchResponse.status}: ${errorBody}`;
        errorCode = `http_${fetchResponse.status}`;
        exitCode = 1;
        await ctx.onLog("stderr", errorMessage);
        break;
      }

      response = (await fetchResponse.json()) as ApiResponse;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isTimeout = isAbort || (err instanceof DOMException && err.name === "TimeoutError");
      errorMessage = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      errorCode = isTimeout ? "timeout" : "fetch_error";
      exitCode = 1;
      await ctx.onLog("stderr", errorMessage);
      break;
    }

    // Accumulate tokens
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;
    totalCachedTokens +=
      (response.usage?.cache_read_input_tokens ?? 0) +
      (response.usage?.cache_creation_input_tokens ?? 0);

    // Process content blocks
    const textParts: string[] = [];
    const toolCalls: ToolUseBlock[] = [];

    for (const block of response.content ?? []) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push(block);
      }
    }

    // Log text output
    if (textParts.length > 0) {
      const text = textParts.join("\n");
      lastTextOutput = text;
      await ctx.onLog("stdout", `[turn ${turn + 1}] ${text}`);
    }

    // Add assistant message to conversation
    messages.push({ role: "assistant", content: response.content });

    // If no tool calls — we're done
    if (response.stop_reason === "end_turn" || toolCalls.length === 0) {
      await ctx.onLog("stdout", `[done] ${turn + 1} turns, ${totalInputTokens + totalOutputTokens} tokens`);
      break;
    }

    // Execute tools and add results
    const toolResults: ToolResultBlock[] = [];
    for (const call of toolCalls) {
      await ctx.onLog("stdout", `[tool] ${call.name}: ${JSON.stringify(call.input).slice(0, 200)}`);
      const { result, isError } = executeTool(call.name, call.input, cwd);
      await ctx.onLog("stdout", `[result] ${result.slice(0, 500)}`);
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.slice(0, 100_000),
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  const costUsd = calculateCostUsd(model, totalInputTokens, totalOutputTokens, totalCachedTokens);

  return {
    exitCode,
    signal: null,
    timedOut: false,
    ...(errorMessage ? { errorMessage, errorCode } : {}),
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cachedInputTokens: totalCachedTokens,
    },
    costUsd,
    billingType: "api",
    provider: "anthropic",
    biller: resolveProviderFromUrl(baseUrl),
    model,
    summary: lastTextOutput.slice(0, 500) || null,
  };
}
