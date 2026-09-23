---
status: accepted
date: 2026-09-23
---

# Server-authoritative, per-property last-writer-wins; no CRDT

Concurrent edits from people and agents are resolved by the document's Durable Object: it applies transactions in arrival order, the last write to a given property of a given node wins, and structural conflicts follow fixed rules (delete beats edit; the editor gets `NODE_GONE`). This is Figma's model and is enough when every client is online and one server orders writes. Agents avoid clobbering people with `ifRev` and `doc_changes` instead of merge semantics.

## Considered Options

- **Yjs / Automerge / Loro CRDT**: gives offline editing and peer merging we do not need yet, at the cost of a second data model beside the scene graph and harder-to-explain merge results for vector geometry.

## Consequences

- No offline editing. If it becomes a requirement, a CRDT can replace the transport inside `packages/sync` without changing the scene graph.
