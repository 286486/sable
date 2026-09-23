// Uint8Array base64 (TC39, shipped in workerd); not yet in TypeScript 5.9's lib.
interface Uint8Array {
  toBase64(): string;
}
