import { expect, it } from "vitest";
import { closeTab, withTab } from "./tabs.ts";

it("adds a Document's tab at the end, once", () => {
  expect(withTab(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  expect(withTab(["a", "b"], "a")).toEqual(["a", "b"]);
});

it("closing the active tab shows the one after it, or before it when it was last", () => {
  expect(closeTab(["a", "b", "c"], "b", "b")).toEqual({ tabs: ["a", "c"], next: "c" });
  expect(closeTab(["a", "b", "c"], "c", "c")).toEqual({ tabs: ["a", "b"], next: "b" });
  expect(closeTab(["a"], "a", "a")).toEqual({ tabs: [], next: null });
});

it("closing another tab keeps the active one", () => {
  expect(closeTab(["a", "b", "c"], "a", "c")).toEqual({ tabs: ["b", "c"], next: "c" });
});
