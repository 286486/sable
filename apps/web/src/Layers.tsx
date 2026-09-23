import { useState } from "react";
import { autoName, rows } from "./layers.ts";
import { combine, objects } from "./selection.ts";
import { send, useStore } from "./store.ts";

const SELECTED = "#DCE6FF";
const icon = {
  width: 20,
  height: 20,
  padding: 0,
  border: "none",
  background: "none",
  cursor: "pointer",
};

/** Illustrator's Layers panel (ADR-0012): the tree topmost first, eye and lock toggles, rows that select. */
export function Layers() {
  // Two selectors, so a drag frame, which changes neither, does not re-render the panel.
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const [toggled, setToggled] = useState(() => new Set<string>());
  if (!doc) return null;

  const toggle = (id: string) => {
    const next = new Set(toggled);
    if (!next.delete(id)) next.add(id);
    setToggled(next);
  };
  const update = (nodeId: string, patch: { visible: boolean } | { locked: boolean }) => {
    useStore.setState({ notice: null });
    send({ type: "update", nodeId, patch });
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 260,
        overflow: "auto",
        background: "#F5F5F5",
        borderLeft: "1px solid #CCC",
        font: "12px system-ui, sans-serif",
      }}
    >
      {rows(doc, toggled).map(({ node, depth, expandable, expanded, dimmed }) => {
        const label = node.name || autoName(node);
        const selected = selection.includes(node.id);
        const pick = (e: React.MouseEvent) => {
          const { doc, selection } = useStore.getState();
          if (!doc) return;
          // A Layer is never selected itself: its row selects the objects in it.
          const ids =
            node.type !== "layer"
              ? [node.id]
              : dimmed
                ? []
                : objects(doc, node.id).map((n) => n.id);
          useStore.setState({
            notice: null,
            selection: combine(selection, ids, { shift: e.shiftKey, alt: e.altKey }),
          });
        };
        return (
          <div
            key={node.id}
            style={{
              display: "flex",
              alignItems: "center",
              height: 22,
              paddingLeft: 4 + depth * 14,
              background: selected ? SELECTED : undefined,
              opacity: dimmed ? 0.5 : 1,
              borderBottom: "1px solid #E4E4E4",
            }}
          >
            <button
              type="button"
              style={icon}
              aria-label={`${node.visible ? "Hide" : "Show"} ${label}`}
              onClick={() => update(node.id, { visible: !node.visible })}
            >
              {node.visible ? "👁" : ""}
            </button>
            <button
              type="button"
              style={icon}
              aria-label={`${node.locked ? "Unlock" : "Lock"} ${label}`}
              onClick={() => update(node.id, { locked: !node.locked })}
            >
              {node.locked ? "🔒" : ""}
            </button>
            {expandable ? (
              <button
                type="button"
                style={icon}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
                aria-expanded={expanded}
                onClick={() => toggle(node.id)}
              >
                {expanded ? "▾" : "▸"}
              </button>
            ) : (
              <span style={{ width: 20 }} />
            )}
            <button
              type="button"
              aria-pressed={selected}
              onClick={pick}
              style={{
                ...icon,
                width: "auto",
                textAlign: "left",
                whiteSpace: "nowrap",
                fontWeight: node.type === "layer" ? 600 : 400,
              }}
            >
              {label}
            </button>
            {node.tags.map((tag) => (
              <span
                key={tag}
                style={{ marginLeft: 4, padding: "0 4px", borderRadius: 3, background: "#E0E0E0" }}
              >
                {tag}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
