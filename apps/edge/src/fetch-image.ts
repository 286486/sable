import { type ImageFile, readImage, ZibelError } from "@zibel/core";

/** `image_place`'s `src` as a checked file and the name a Template Layer takes (ADR-0027). */
export async function fetchImage(src: string): Promise<ImageFile & { name: string }> {
  if (src.startsWith("data:")) return { ...readImage(src, "src"), name: "Image" };
  throw new ZibelError({
    code: "INVALID_IMAGE",
    message: "src is not an http or https URL, or a data: URL.",
    hint: "The server cannot read your disk: read the file and send it as a data: URL, or give a public http(s) URL.",
    path: "src",
  });
}
