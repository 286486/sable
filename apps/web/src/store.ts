import { newId } from "@zibel/core";
import type { ClientMessage, Command, ServerMessage } from "@zibel/sync";
import { create } from "zustand";
import { receive, type Session } from "./receive.ts";
import type { Viewport } from "./viewport.ts";

interface State extends Session {
  /** False while the socket is down; the last Document stays on screen. */
  live: boolean;
  /** Null until the first Document arrives and is fitted to the screen. */
  viewport: Viewport | null;
}

export const useStore = create<State>(() => ({
  doc: null,
  live: false,
  viewport: null,
  selection: [],
  drag: null,
  notice: null,
}));

let socket: WebSocket | null = null;

/**
 * Sends one gesture to the Document (ADR-0010) and returns its id, which its answer carries. While
 * the socket is down it is dropped: the Document sent on reconnect clears what waited on it.
 */
export function send(command: Command): string {
  const id = newId();
  const msg: ClientMessage = { type: "command", id, command };
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  return id;
}

/** Subscribes to a Document (ADR-0009) until the returned function is called. */
export function connect(docId: string): () => void {
  let ws: WebSocket;
  let retry: ReturnType<typeof setTimeout>;
  let stopped = false;
  const open = () => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}/api/docs/${docId}/ws`);
    socket = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      const next = receive(useStore.getState(), msg, docId);
      if (next) useStore.setState({ ...next, ...(msg.type === "document" && { live: true }) });
      else ws.close(); // A missed rev: reconnect for the whole Document.
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
    socket = null;
    ws.close();
  };
}
