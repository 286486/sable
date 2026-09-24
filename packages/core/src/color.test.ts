import { expect, it } from "vitest";
import { cssColor, parseColor } from "./color.ts";

it.each([
  ["#abc", "#AABBCC"],
  ["#abcd", "#AABBCCDD"],
  ["#A1B2C3", "#A1B2C3"],
  ["#a1b2c3ff", "#A1B2C3"],
  ["#a1b2c380", "#A1B2C380"],
  ["rgb(255, 0, 0)", "#FF0000"],
  ["rgb(100%,0%,0%)", "#FF0000"],
  ["rgba(0,0,255,.5)", "#0000FF80"],
  ["rgb(0 0 255 / 50%)", "#0000FF80"],
  ["hsl(120 100% 50%)", "#00FF00"],
  ["hsla(240, 100%, 50%, 0.25)", "#0000FF40"],
  ["hsl(-120deg 100% 50%)", "#0000FF"],
  ["RebeccaPurple", "#663399"],
  ["lightgoldenrodyellow", "#FAFAD2"],
  ["transparent", "#00000000"],
  [" white ", "#FFFFFF"],
])("reads the CSS colour %s as %s", (css, hex) => {
  expect(cssColor(css)).toBe(hex);
});

it.each(["none", "currentColor", "url(#g)", "abc", "#12", "rgb(1,2)", "notacolour"])(
  "reads %s as no colour",
  (css) => {
    expect(cssColor(css)).toBeNull();
  },
);

it("hints the hex form of a CSS colour an Agent passed", () => {
  expect(() => parseColor("hsl(0 100% 50%)", "c")).toThrow(
    expect.objectContaining({
      data: expect.objectContaining({ hint: expect.stringContaining('"#FF0000"') }),
    }),
  );
});
