import { actorFor, permissionDenied } from "./auth.ts";

export { DocumentObject } from "./document-object.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    const actor = actorFor(request, env.DEV_TOKENS);
    if (!actor) return permissionDenied();
    return new Response(null, { status: 204 });
  },
} satisfies ExportedHandler<Env>;
