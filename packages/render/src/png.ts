import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";

// Workers forbid compiling wasm from bytes at runtime, so the module is imported statically
// and initialised once per isolate.
const ready = initWasm(wasm);

export async function svgToPng(
  svg: string,
  scale: number,
): Promise<{ png: Uint8Array; width: number; height: number }> {
  await ready;
  const resvg = new Resvg(svg, { fitTo: { mode: "zoom", value: scale } });
  const image = resvg.render();
  try {
    return { png: image.asPng(), width: image.width, height: image.height };
  } finally {
    image.free();
    resvg.free();
  }
}
