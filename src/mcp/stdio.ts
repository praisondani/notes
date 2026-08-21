import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpScope } from "@/lib/mcp-auth";
import { createMcpServer } from "@/mcp/server";

const readOnly = process.env.MCP_STDIO_READ_ONLY === "1";
const scopes = new Set<McpScope>(readOnly ? ["notes:read"] : ["notes:read", "notes:write"]);
const server = createMcpServer({
  tokenId: "stdio",
  tokenPrefix: "stdio",
  scopes,
  source: "stdio",
});
const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch {
  console.error("Notes MCP stdio server failed to start");
  process.exitCode = 1;
}
