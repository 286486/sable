import type { Artboard, Document, Node } from "@zibel/core";

/** Browser wire protocol (ADR-0009): the Document on connect, then one `tx` per commit. */

/** Sent once, right after the WebSocket is accepted. */
export interface DocumentMessage {
  type: "document";
  rev: number;
  name: string;
  artboards: Artboard[];
  nodes: Node[];
}

/** One committed Transaction, with full copies of the Nodes it created or updated. */
export interface TxMessage {
  type: "tx";
  rev: number;
  txId: string;
  actor: string;
  intent: string | null;
  created: Node[];
  updated: Node[];
  /** Includes the descendants of every deleted Node. */
  deletedIds: string[];
}

export type ServerMessage = DocumentMessage | TxMessage;

/** `doc` with `msg` applied, as a new object; `doc` is left untouched. */
export function applyBroadcast(doc: Document, msg: TxMessage): Document {
  const nodes = new Map(doc.nodes);
  for (const n of [...msg.created, ...msg.updated]) nodes.set(n.id, n);
  for (const id of msg.deletedIds) nodes.delete(id);
  return { ...doc, rev: msg.rev, nodes };
}
