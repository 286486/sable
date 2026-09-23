type Env = Cloudflare.Env;

declare namespace Cloudflare {
  interface Env {
    DOCUMENT: DurableObjectNamespace<import("./document-object.ts").DocumentObject>;
    DEV_TOKENS: string;
  }
  interface GlobalProps {
    mainModule: typeof import("./index.ts");
    durableNamespaces: "DocumentObject";
  }
}
