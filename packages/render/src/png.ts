import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import font from "../fonts/SourceSans3-Regular.ttf";

// Workers forbid compiling wasm from bytes at runtime, so the module is imported statically
// and initialised once per isolate.
const ready = initWasm(wasm);

// The one bundled font (ADR-0013); workerd has no system fonts to fall back on.
const fonts = {
  fontBuffers: [new Uint8Array(font)],
  loadSystemFonts: false,
  defaultFontFamily: "Source Sans 3",
};

async function rasterise<T>(
  svg: string,
  scale: number,
  read: (image: { asPng(): Uint8Array; pixels: Uint8Array }) => T,
): Promise<{ width: number; height: number } & T> {
  await ready;
  // At 72 dpi the root's pt is one pixel per point, so zoom is pixels per point (ADR-0017).
  const resvg = new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, dpi: 72, font: fonts });
  const image = resvg.render();
  try {
    return { ...read(image), width: image.width, height: image.height };
  } finally {
    image.free();
    resvg.free();
  }
}

export const svgToPng = (svg: string, scale: number) =>
  rasterise(svg, scale, (image) => ({ png: image.asPng() }));

/** Raw RGBA, row by row; for tests, since workerd cannot decode a PNG. */
export const svgToPixels = (svg: string, scale: number) =>
  rasterise(svg, scale, (image) => ({ pixels: image.pixels.slice() }));
