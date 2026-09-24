import type { APIRequestContext } from "@playwright/test";

/** One stateless MCP `tools/call` as Agent `agent-a`; returns the CallToolResult. */
export async function call(request: APIRequestContext, name: string, args: object) {
  const res = await request.post("/mcp", {
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer dev-token-a",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  return (await res.json()).result;
}
