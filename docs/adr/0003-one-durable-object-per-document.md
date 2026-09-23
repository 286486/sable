---
status: accepted
date: 2026-09-23
---

# One Cloudflare Durable Object per document is the authoritative store

Each document lives in its own Durable Object, which holds the current state and the transaction log in its SQLite storage, serialises every write, and broadcasts committed transactions to connected browsers. Full snapshots go to R2; user and document metadata go to D1. We chose this over a central database because a single-threaded owner per document gives us write ordering, transactions and fan-out for free, and documents are independent of each other.

## Considered Options

- **Central database (D1 / Postgres) plus a stateless API**: needs its own locking and a separate pub/sub layer for live updates.
- **Node server with in-memory documents**: a stateful fleet to operate and shard ourselves.

## Consequences

- A DO key/value is capped at 2 MB, so the document is never stored as one blob: nodes and log entries are rows, snapshots go to R2.
- Throughput for one document is bounded by one DO. The design target is at most 50 active connections per document.
- Local development and self-hosting run the same code under `wrangler dev` / workerd; there is no second storage implementation.
