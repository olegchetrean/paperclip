export const type = "anthropic_api";
export const label = "Anthropic API (direct)";

export const models = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export const agentConfigurationDoc = `# anthropic_api agent configuration

Adapter: anthropic_api

Direct HTTP connection to Anthropic Messages API (works with Azure, Bedrock, or direct Anthropic).

Use when:
- You want direct HTTP API calls to Anthropic models without a local CLI.
- You are using Azure-hosted Claude or AWS Bedrock-hosted Claude.
- You need fine-grained token/cost tracking per run.

Don't use when:
- You need interactive tool use or agentic loops (use claude_local instead).
- You want local file system access or MCP tools.

Core fields:
- apiKey (string, required): Anthropic API key or Azure API key
- baseUrl (string, optional): API base URL (default: https://api.anthropic.com). For Azure: https://YOUR-RESOURCE.services.ai.azure.com/anthropic/v1
- model (string, optional): Model ID (default: claude-sonnet-4-6)
- systemPrompt (string, optional): System prompt for all runs
- maxTokens (number, optional): Max output tokens (default: 16384)
- temperature (number, optional): Temperature (default: 1.0)
- timeoutSec (number, optional): Request timeout in seconds (default: 300)
`;
