export const MCP_SCOPES = ["notes:read", "notes:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const DEFAULT_MCP_SCOPES: McpScope[] = ["notes:read", "notes:write"];

export function normalizeMcpScopes(value: readonly string[] | undefined, fallback: McpScope[] = DEFAULT_MCP_SCOPES): McpScope[] {
  const scopes = [...new Set((value ?? fallback).map((scope) => scope.trim()).filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !MCP_SCOPES.includes(scope as McpScope))) {
    throw new Error("Invalid MCP scopes");
  }
  return scopes as McpScope[];
}

export function uniqueMcpScopes(scopes: readonly McpScope[]): McpScope[] {
  return MCP_SCOPES.filter((scope) => scopes.includes(scope));
}
