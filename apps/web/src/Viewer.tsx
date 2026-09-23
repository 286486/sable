import { type Document, union } from "@zibel/core";
import { drawDocument } from "@zibel/render/canvas";
import { useEffect, useRef, useState } from "react";
import { connect, useStore } from "./store.ts";
import { fit, type Viewport, zoomAt } from "./viewport.ts";

const PASTEBOARD = "#E6E6E6";

/** Pinch sends small deltas and passes through; a mouse-wheel notch (about 100) is capped to x1.65. */
const wheelZoom = (deltaY: number) => Math.exp(-Math.max(-50, Math.min(50, deltaY)) * 0.01);

const artboardsRect = (doc: Document) =>
  union(doc.artboards.map((a) => a.frame)) ?? { x: 0, y: 0, width: 100, height: 100 };

/** A live, read-only view of one Document. */
export function Viewer({ docId }: { docId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { doc, live, viewport } = useStore();
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** Space held: drag pans. */
  const [hand, setHand] = useState(false);
  /** Illustrator's Zoom tool (Z): click zooms in, Alt+click out. */
  const [zoomTool, setZoomTool] = useState(false);
  const [alt, setAlt] = useState(false);

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
    if (!el || !ctx || !doc || !viewport) return;
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
    drawDocument(ctx, doc);
  }, [doc, viewport, size]);

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
      const { doc, viewport: v } = useStore.getState();
      if (!doc || !v) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "0") {
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

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = useStore.getState().viewport;
    if (!v) return;
    if (hand) {
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (zoomTool) {
      const r = e.currentTarget.getBoundingClientRect();
      const factor = e.altKey ? 0.5 : 2;
      useStore.setState({ viewport: zoomAt(v, factor, e.clientX - r.left, e.clientY - r.top) });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = useStore.getState().viewport;
    if (!v || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    useStore.setState({ viewport: { ...v, x: v.x + e.movementX, y: v.y + e.movementY } });
  };

  const cursor = hand ? "grab" : zoomTool ? (alt ? "zoom-out" : "zoom-in") : "default";

  return (
    <div style={{ position: "fixed", inset: 0, background: PASTEBOARD }}>
      <canvas
        ref={canvas}
        style={{ width: "100%", height: "100%", display: "block", cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      />
      <div style={{ position: "absolute", top: 8, left: 12, color: "#444" }}>
        <a href="/">Documents</a> / {doc?.name ?? docId}
        {viewport && ` · ${Math.round(viewport.scale * 100)}%`}
        {!live && " · connecting…"}
      </div>
    </div>
  );
}
