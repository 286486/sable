import { childrenOf, type Document, type Node } from "@zibel/core";
import { editable } from "./selection.ts";

const AUTO_NAMES: Record<Node["type"], string> = {
  rect: "<Rectangle>",
  ellipse: "<Ellipse>",
  line: "<Line>",
  polygon: "<Polygon>",
  star: "<Star>",
  path: "<Path>",
  group: "<Group>",
  layer: "<Layer>",
};

/** What the Layers panel shows for a Node whose `name` is empty; never stored (ADR-0012). */
export const autoName = (node: Node) => AUTO_NAMES[node.type];

/** One line of the Layers panel. */
export interface Row {
  node: Node;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  /** Hidden or locked, itself or through an ancestor. */
  dimmed: boolean;
}

/**
 * The Layers panel's rows, siblings topmost first (ADR-0012). `toggled` holds the containers
 * expanded or collapsed away from their default: Layers start expanded, Groups collapsed.
 * ponytail: childrenOf scans every Node per container, O(n²); index children when Documents grow.
 */
export function rows(doc: Document, toggled: Set<string>): Row[] {
  const walk = (parentId: string | null, depth: number): Row[] =>
    childrenOf(doc, parentId)
      .reverse()
      .flatMap((node) => {
        const expandable =
          (node.type === "layer" || node.type === "group") && childrenOf(doc, node.id).length > 0;
        const expanded = expandable && (node.type === "layer") !== toggled.has(node.id);
        const row = { node, depth, expandable, expanded, dimmed: !editable(doc, node) };
        return expanded ? [row, ...walk(node.id, depth + 1)] : [row];
      });
  return walk(null, 0);
}
