// Vite's import.meta.glob, in the one form the tests use; the root tsconfig has no Vite types.
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, string>;
}
