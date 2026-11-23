/**
 * Release gate for AI agent connections (MCP + OAuth 2.1). R2: flip only after an independent
 * verification in a separate context. The Worker and the UI read the same constant, so the
 * connection screens never appear while the server endpoints are closed. Opened after the
 * independent verification of #219 (2026-11-23).
 */
export const AGENT_MCP_RELEASE_ENABLED = true;

/**
 * Release gate for the student's own taste ledger and its MCP material tools (C23, R2).
 * Closed: the tools are absent from tools/list, get_writing_guide has no personal section, and
 * the agent's own draft versions are not recorded. Opened after the independent verification of
 * #242 (2026-11-23). It only takes effect while AGENT_MCP_RELEASE_ENABLED is also open. The account
 * screen and sharing with operators (#243) need their own verification and their own gate.
 */
export const TASTE_LEDGER_RELEASE_ENABLED = true;

/**
 * Release gate for the account screen's ledger list, per-line delete and 「運営に見せる」, and
 * the operators' read of shown lines (C23 condition 4, #243, R2). Separate from the gate above so
 * that sharing with operators stays closed until its own independent verification.
 */
export const TASTE_SHARING_RELEASE_ENABLED = true;
