import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ZibelError } from "@zibel/core";
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
    if (url.pathname === "/api/docs" && request.method === "POST") return openFile(request, env);
    const replace = url.pathname.match(/^\/api\/docs\/([^/]+)\/replace$/)?.[1];
    if (replace && request.method === "POST") {
      return answer(async () =>
        documentService(env, "user").replace(replace, { content: await request.text() }),
      );
    }
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

/**
 * The browser's Open file: the file's text as the body, its name in `?name=`. Over HTTP, not the
 * WebSocket, since a file does not belong in a gesture message (ADR-0017); by the user. Its
 * "Update from file…" (Replace) posts to `/api/docs/:docId/replace` the same way.
 */
async function openFile(request: Request, env: Env): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name") ?? undefined;
  return answer(async () => {
    const { docId, warnings } = await documentService(env, "user").open({
      content: await request.text(),
      name,
    });
    return { docId, warnings };
  });
}

/** `fn`'s result as JSON, or its ZibelError as a 400. */
async function answer(fn: () => Promise<object>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ZibelError) return Response.json(e.data, { status: 400 });
    throw e;
  }
}
