/**
 * Release gate for AI agent connections (MCP + OAuth 2.1). R2: flip only after an independent
 * verification in a separate context. The Worker and the UI read the same constant, so the
 * connection screens never appear while the server endpoints are closed.
 */
export const AGENT_MCP_RELEASE_ENABLED = false;

/**
 * Release gate for the student's own taste ledger and its MCP material tools (C23, R2).
 * Closed: the tools are absent from tools/list, get_writing_guide has no personal section, and
 * the agent's own draft versions are not recorded. Open only after an independent verification.
 */
export const TASTE_LEDGER_RELEASE_ENABLED = false;
