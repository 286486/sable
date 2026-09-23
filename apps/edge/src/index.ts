import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@zibel/mcp";
import { actorFor, permissionDenied } from "./auth.ts";
import { documentService, listDocuments } from "./service.ts";

export { DocumentObject } from "./document-object.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    // Browsers are not authenticated in M0: the viewer is read-only and local (ADR-0009).
    const ws = url.pathname.match(/^\/api\/docs\/([^/]+)\/ws$/)?.[1];
    if (ws) return env.DOCUMENT.get(env.DOCUMENT.idFromName(ws)).fetch(request);
    if (url.pathname === "/api/docs") return Response.json({ documents: await listDocuments(env) });
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    const actor = actorFor(request, env.DEV_TOKENS);
    if (!actor) return permissionDenied();
    // GET would open a server-to-client stream and DELETE ends a session; stateless MCP has neither.
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    // Stateless (ADR-0006): no session id, a new server and transport per request.
    const server = createMcpServer(documentService(env, actor), actor);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
