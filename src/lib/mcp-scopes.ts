export const MCP_SCOPES = ["notes:read", "notes:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export function normalizeMcpScopes(value: readonly string[] | undefined, fallback: McpScope[] = ["notes:read"]): McpScope[] {
  const scopes = [...new Set((value ?? fallback).map((scope) => scope.trim()).filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !MCP_SCOPES.includes(scope as McpScope))) {
    throw new Error("Invalid MCP scopes");
  }
  return scopes as McpScope[];
}
