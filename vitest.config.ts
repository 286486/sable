import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./apps/edge/wrangler.jsonc" } })],
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
