import { ZibelError } from "./errors.ts";

export const COLOR_PATTERN = "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$";
const HEX = new RegExp(COLOR_PATTERN);

// ponytail: the common CSS names only; the hint falls back to the generic format for the rest.
const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  orange: "#FFA500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  transparent: "#00000000",
};

/**
 * Returns `value` if it is `#RRGGBB` or `#RRGGBBAA`, else throws INVALID_COLOR whose hint carries the
 * hex form of what the Agent probably meant (REQUIREMENTS §6.5).
 */
export function parseColor(value: unknown, path: string): string {
  if (typeof value === "string" && HEX.test(value)) return value;
  const hex = suggest(value);
  throw new ZibelError({
    code: "INVALID_COLOR",
    message: `${JSON.stringify(value) ?? "undefined"} is not a color.`,
    hint: hex
      ? `Use "${hex}". Colors are #RRGGBB or #RRGGBBAA.`
      : "Colors are #RRGGBB or #RRGGBBAA, e.g. #FF8800 or #FF880080 at half opacity.",
    path,
  });
}

function suggest(value: unknown): string | null {
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    const short = /^#?([0-9a-f]{3,4})$/.exec(s)?.[1];
    if (short) return `#${[...short].map((c) => c + c).join("")}`.toUpperCase();
    const long = /^([0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)?.[1];
    if (long) return `#${long}`.toUpperCase();
    const rgb = /^rgba?\(([^)]*)\)$/
      .exec(s)?.[1]
      ?.split(/[\s,/]+/)
      .filter(Boolean);
    if (rgb) return channels(rgb.map(Number), false);
    return NAMED[s] ?? null;
  }
  if (Array.isArray(value))
    return channels(
      value,
      value.every((n) => n <= 1),
    );
  if (value && typeof value === "object") {
    const { r, g, b, a } = value as Record<string, unknown>;
    const list = a === undefined ? [r, g, b] : [r, g, b, a];
    return channels(
      list,
      list.every((n) => typeof n === "number" && n <= 1),
    );
  }
  return null;
}

/** `[r, g, b, a?]` as hex; `unit` means r, g, b are 0–1 floats. Alpha is always 0–1. */
function channels(list: unknown[], unit: boolean): string | null {
  if (list.length < 3 || list.length > 4) return null;
  if (!list.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const byte = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  const nums = list as number[];
  return `#${nums.map((n, i) => byte(unit || i === 3 ? n * 255 : n)).join("")}`.toUpperCase();
}
