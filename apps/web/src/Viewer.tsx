import { bounds, type Document, type Rect, union } from "@zibel/core";
import { drawDocument } from "@zibel/render/canvas";
import fontUrl from "@zibel/render/fonts/SourceSans3-Regular.ttf?url";
import { useEffect, useRef, useState } from "react";
import { Layers } from "./Layers.tsx";
import { preview } from "./receive.ts";
import { combine, editable, hitTest, inverse, marquee, objects } from "./selection.ts";
import { connect, send, useStore } from "./store.ts";
import { fit, toDoc, type Viewport, zoomAt } from "./viewport.ts";

const PASTEBOARD = "#E6E6E6";
/** Illustrator's first Layer colour, used for the Selection and the marquee. */
const SELECTION = "#4F80FF";
/** Screen px the pointer may wander before a press becomes a drag, and the hit tolerance. */
const SLOP = 3;

type Point = { x: number; y: number };
type Mods = { shift: boolean; alt: boolean };
/** A press of the Selection tool: moving the Selection, or drawing a marquee. */
type Gesture =
  | { kind: "move"; start: Point; nodeIds: string[]; moved: boolean }
  | { kind: "marquee"; start: Point; mods: Mods; moved: boolean };

const rectOf = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** Pinch sends small deltas and passes through; a mouse-wheel notch (about 100) is capped to x1.65. */
const wheelZoom = (deltaY: number) => Math.exp(-Math.max(-50, Math.min(50, deltaY)) * 0.01);

// The font the Worker renders with (ADR-0013), loaded once per page.
const font = new FontFace("Source Sans 3", `url(${fontUrl})`);
document.fonts.add(font);
const fontLoaded = font.load();

const artboardsRect = (doc: Document) =>
  union(doc.artboards.map((a) => a.frame)) ?? { x: 0, y: 0, width: 100, height: 100 };

/** A live view of one Document: select, drag-move and delete its objects. */
export function Viewer({ docId }: { docId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { doc, live, viewport, selection, drag, notice } = useStore();
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** Space held: drag pans. */
  const [hand, setHand] = useState(false);
  /** Illustrator's Zoom tool (Z): click zooms in, Alt+click out. */
  const [zoomTool, setZoomTool] = useState(false);
  const [alt, setAlt] = useState(false);
  /** Pointer position at the last pan step; movementX/Y scale with devicePixelRatio in some Chromes. */
  const last = useRef({ x: 0, y: 0 });
  const gesture = useRef<Gesture | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  /** Settled once the font has loaded, or failed to and text falls back to another font. */
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    const ready = () => setFontReady(true);
    fontLoaded.then(ready, ready);
  }, []);

  useEffect(() => connect(docId), [docId]);

  useEffect(() => {
    if (doc) document.title = `${doc.name} – Zibel`;
  }, [doc]);

  // Track the canvas size in CSS px.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit the Artboards once the first Document arrives.
  useEffect(() => {
    if (doc && !viewport && size.width > 0) {
      useStore.setState({ viewport: fit(artboardsRect(doc), size.width, size.height) });
    }
  }, [doc, viewport, size]);

  // ponytail: redraws everything on every change; add viewport culling and dirty rects for 5k+ Nodes (F-VIEW-08).
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !doc || !viewport || !fontReady) return;
    const dpr = devicePixelRatio;
    el.width = Math.round(size.width * dpr);
    el.height = Math.round(size.height * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PASTEBOARD;
    ctx.fillRect(0, 0, el.width, el.height);
    const { x, y, scale } = viewport;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y);
    for (const { frame } of doc.artboards) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
    }
    // Hit tests use `doc`; only the drawing shows the drag.
    const shown = drag ? preview(doc, drag) : doc;
    drawDocument(ctx, shown);
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = SELECTION;
    for (const id of selection) {
      const node = shown.nodes.get(id);
      const b = node && bounds(shown, node);
      if (b) ctx.strokeRect(b.x, b.y, b.width, b.height);
    }
    if (marqueeRect) {
      ctx.setLineDash([4 / scale, 4 / scale]);
      const { x: mx, y: my, width, height } = marqueeRect;
      ctx.strokeRect(mx, my, width, height);
      ctx.setLineDash([]);
    }
  }, [doc, viewport, size, selection, drag, marqueeRect, fontReady]);

  // Ctrl+wheel (and trackpad pinch) zooms at the cursor; plain wheel and two-finger scroll pan.
  // A native listener, because React's onWheel is passive and cannot preventDefault.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useStore.getState().viewport;
      if (!v) return;
      const r = el.getBoundingClientRect();
      useStore.setState({
        viewport:
          e.ctrlKey || e.metaKey
            ? zoomAt(v, wheelZoom(e.deltaY), e.clientX - r.left, e.clientY - r.top)
            : { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY },
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const set = (v: Viewport) => useStore.setState({ viewport: v });
    const onKey = (e: KeyboardEvent) => {
      setAlt(e.altKey);
      const down = e.type === "keydown";
      if (e.code === "Space") {
        e.preventDefault();
        setHand(down);
        return;
      }
      if (!down) return;
      const { doc, viewport: v, selection } = useStore.getState();
      if (!doc || !v) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        send({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && key === "a") {
        e.preventDefault();
        useStore.setState({ selection: e.shiftKey ? [] : objects(doc).map((n) => n.id) });
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection.length > 0) {
        e.preventDefault();
        // The answering tx prunes the Selection; a rejection keeps it for another press.
        const nodeIds = selection.filter((id) => editable(doc, doc.nodes.get(id)));
        if (nodeIds.length > 0) send({ type: "delete", nodeIds });
      } else if (mod && e.key === "0") {
        e.preventDefault();
        set(fit(artboardsRect(doc), size.width, size.height));
      } else if (mod && e.key === "1") {
        e.preventDefault();
        set(zoomAt(v, 1 / v.scale, size.width / 2, size.height / 2));
      } else if (!mod && e.key.toLowerCase() === "z") {
        setZoomTool(true);
      } else if (!mod && (e.key === "Escape" || e.key.toLowerCase() === "v")) {
        setZoomTool(false);
      }
    };
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onKey);
    };
  }, [size]);

  /** The pointer in document coordinates. */
  const docPoint = (e: React.PointerEvent<HTMLCanvasElement>, v: Viewport) => {
    const r = e.currentTarget.getBoundingClientRect();
    return toDoc(v, e.clientX - r.left, e.clientY - r.top);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { doc, viewport: v, selection } = useStore.getState();
    if (!doc || !v) return;
    if (hand) {
      e.currentTarget.setPointerCapture(e.pointerId);
      last.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (zoomTool) {
      const r = e.currentTarget.getBoundingClientRect();
      const factor = e.altKey ? 0.5 : 2;
      useStore.setState({ viewport: zoomAt(v, factor, e.clientX - r.left, e.clientY - r.top) });
      return;
    }
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const start = docPoint(e, v);
    const mods = { shift: e.shiftKey, alt: e.altKey };
    const hit = hitTest(ctx, doc, start.x, start.y, SLOP / v.scale);
    useStore.setState({ notice: null });
    if (hit && mods.shift) {
      useStore.setState({ selection: combine(selection, [hit], mods) });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (hit) {
      // Pressing a selected object keeps the Selection, so all of it that is editable moves.
      const kept = selection.includes(hit);
      if (!kept) useStore.setState({ selection: [hit] });
      const nodeIds = kept ? selection.filter((id) => editable(doc, doc.nodes.get(id))) : [hit];
      gesture.current = { kind: "move", start, nodeIds, moved: false };
    } else {
      gesture.current = { kind: "marquee", start, mods, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = useStore.getState().viewport;
    if (!v || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const g = gesture.current;
    if (!g) {
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      useStore.setState({ viewport: { ...v, x: v.x + dx, y: v.y + dy } });
      return;
    }
    const p = docPoint(e, v);
    const [dx, dy] = [p.x - g.start.x, p.y - g.start.y];
    g.moved ||= Math.hypot(dx, dy) * v.scale >= SLOP;
    if (!g.moved) return;
    if (g.kind === "move")
      useStore.setState({ drag: { nodeIds: g.nodeIds, dx, dy, commandId: null } });
    else setMarqueeRect(rectOf(g.start, p));
  };

  /** Releasing commits a move as one Transaction, or applies the marquee (a click if it never moved). */
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    const { doc, drag, selection } = useStore.getState();
    if (!g || !doc) return;
    if (g.kind === "marquee") {
      const ids = g.moved && marqueeRect ? marquee(doc, marqueeRect) : [];
      useStore.setState({ selection: combine(selection, ids, g.mods) });
      setMarqueeRect(null);
    } else if (g.moved && drag && drag.commandId === null) {
      // ponytail: TransformInput takes at most 1000 nodeIds: a larger drag crashes preview() and
      // is closed with 1007 by the DO; chunk the command or lift the max when Documents grow.
      const translate = { x: drag.dx, y: drag.dy };
      const commandId = send({ type: "transform", input: { nodeIds: drag.nodeIds, translate } });
      useStore.setState({ drag: { ...drag, commandId } });
    }
  };

  const onPointerCancel = () => {
    gesture.current = null;
    setMarqueeRect(null);
    if (useStore.getState().drag?.commandId === null) useStore.setState({ drag: null });
  };

  const select = (pick: (doc: Document, selection: string[]) => string[]) => () => {
    const { doc, selection } = useStore.getState();
    if (doc) useStore.setState({ selection: pick(doc, selection) });
  };

  const cursor = hand ? "grab" : zoomTool ? (alt ? "zoom-out" : "zoom-in") : "default";

  return (
    <div style={{ position: "fixed", inset: 0, background: PASTEBOARD }}>
      <canvas
        ref={canvas}
        style={{ width: "100%", height: "100%", display: "block", cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      <div style={{ position: "absolute", top: 8, left: 12, color: "#444" }}>
        <a href="/">Documents</a> / {doc?.name ?? docId}
        {viewport && ` · ${Math.round(viewport.scale * 100)}%`}
        {!live && " · connecting…"}{" "}
        <button type="button" onClick={select((d) => objects(d).map((n) => n.id))}>
          Select All
        </button>{" "}
        <button type="button" onClick={select(() => [])}>
          Deselect
        </button>{" "}
        <button type="button" onClick={select(inverse)}>
          Inverse
        </button>
        {notice && <div style={{ color: "#B00020" }}>{notice}</div>}
      </div>
      <Layers />
    </div>
  );
}
