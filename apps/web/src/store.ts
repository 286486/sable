import type { Document } from "@zibel/core";
import { applyBroadcast, type ServerMessage } from "@zibel/sync";
import { create } from "zustand";
import type { Viewport } from "./viewport.ts";

interface State {
  doc: Document | null;
  /** False while the socket is down; the last Document stays on screen. */
  live: boolean;
  /** Null until the first Document arrives and is fitted to the screen. */
  viewport: Viewport | null;
}

export const useStore = create<State>(() => ({ doc: null, live: false, viewport: null }));

/** Subscribes to a Document (ADR-0009) until the returned function is called. */
export function connect(docId: string): () => void {
  let ws: WebSocket;
  let retry: ReturnType<typeof setTimeout>;
  let stopped = false;
  const open = () => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}/api/docs/${docId}/ws`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      const { doc } = useStore.getState();
      if (msg.type === "document") {
        const nodes = new Map(msg.nodes.map((n) => [n.id, n]));
        const { rev, name, artboards } = msg;
        useStore.setState({
          live: true,
          doc: { id: docId, name, version: 1, rev, artboards, nodes },
        });
      } else if (msg.type === "tx" && doc && msg.rev === doc.rev + 1) {
        useStore.setState({ doc: applyBroadcast(doc, msg) });
      } else {
        ws.close(); // A missed rev: reconnect for the whole Document.
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      useStore.setState({ live: false });
      // ponytail: fixed 1 s retry, forever; back off if many tabs hammer a dead server.
      retry = setTimeout(open, 1000);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    ws.close();
  };
}
