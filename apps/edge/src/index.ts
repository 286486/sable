import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@zibel/mcp";
import { actorFor, permissionDenied } from "./auth.ts";
import { documentService } from "./service.ts";

export { DocumentObject } from "./document-object.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    const actor = actorFor(request, env.DEV_TOKENS);
    if (!actor) return permissionDenied();
    // Stateless (ADR-0006): no session id, a new server and transport per request.
    const server = createMcpServer(documentService(env, actor));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
