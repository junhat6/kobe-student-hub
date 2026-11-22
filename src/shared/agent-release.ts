/**
 * Release gate for AI agent connections (MCP + OAuth 2.1). R2: flip only after an independent
 * verification in a separate context. The Worker and the UI read the same constant, so the
 * connection screens never appear while the server endpoints are closed.
 */
export const AGENT_MCP_RELEASE_ENABLED = false;
