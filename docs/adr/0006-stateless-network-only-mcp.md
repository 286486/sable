---
status: accepted
date: 2026-09-23
---

# MCP is stateless Streamable HTTP only

The MCP server keeps no state between requests: no stdio transport, no `Mcp-Session-Id`, no `resources/subscribe`, no elicitation or other server-initiated requests. Every request carries a Bearer token (which identifies the Actor) and every address it needs (`docId`, `txId`), so any Worker instance can serve it. All state that must outlive a request lives in the document's Durable Object. The product owner required a stateless, network-only MCP; it also means local, self-hosted and hosted deployments behave identically.

## Considered Options

- **stdio for local plus stateful HTTP for hosted**: two transports to test, session-scoped transactions and locks that break when a Worker instance is recycled.

## Consequences

- Multi-call transactions survive: `txId` is explicit and stored in the DO, rolled back after 5 minutes idle instead of on disconnect. Soft locks hang off `txId`.
- Agents learn about human edits by pulling `doc_changes(sinceRev)` and guard writes with `ifRev` (`REV_CONFLICT` on mismatch).
- Decisions that need a person return `NEEDS_DECISION` for the agent to ask in its own conversation.
- Progress is streamed only within one request's SSE response; jobs expected to run longer than about 30 seconds return a `jobId` for polling.
- Each MCP client authorises separately and gets its own token, so each is a distinct Actor.
