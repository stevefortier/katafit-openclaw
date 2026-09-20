# Browser authorization follow-up

**Design proposal, not an implemented API or available login flow.** The first plugin uses Kata.fit's existing scoped bearer credential. It does not refresh, recover, or mint credentials. Its polling worker is plugin-owned; users do not need to configure MCP or build a scheduler.

## Intended experience

1. Install the released plugin using OpenClaw's supported installer.
2. Begin connection from a plugin-owned CLI or supported settings surface.
3. Open Kata.fit in the system browser, authenticate there, and review permissions.
4. Select the authorized personal connection or chief-managed dojo connection.
5. Explicitly approve the named installation.
6. The plugin stores the resulting credential privately and starts its worker.
7. Verify an attributed reply in the originating Kata.fit Coach conversation before calling setup complete.

A device-authorization flow is suitable for headless hosts. Use a standards-based implementation, not tokens in browser query strings, chat messages, process arguments, or copyable agent prompts. Final endpoint names and request schemas must be published by the backend before a client implements them.

## Backend requirements

- Short-lived, single-use authorization transactions with expiry, rate limits, and atomically consumed grants.
- Separate secret device transaction and human confirmation codes. A verification URL must not contain the final bearer token.
- Explicit approval by an authenticated user. Being signed in, opening a link, or possessing a confirmation code alone must not authorize an installation.
- Recheck ownership and current chief/membership authority at issuance, not merely when the browser page opens. Ordinary dojo members cannot authorize a shared connection.
- Display the installation identity, actual scope and permissions, and expiry before approval. Deny by default; no proposal/mutation access merely because chat access was granted.
- Reuse existing credential revocation and ownership fencing. Leaving a dojo, changing its chief, revoking a connection, or losing a requester's authority must not be bypassed by reconnecting or refreshing.
- If refresh credentials are introduced, rotate them atomically, detect reuse, revoke the credential family, and define recovery for an interrupted rotation. Until then, report expiry and request reconnection; do not describe fixed bearer credentials as renewable.
- Private credential storage and redacted logs on both sides. Never expose token hashes or refresh secrets in health responses.
- Respect authorization-server polling intervals and slow-down responses. Authorization polling is separate from the coaching request worker.

## Delivery and health follow-up

The current server contract is polling-based. A subscription is a future transport, not a prerequisite for removing user-written polling.

Any future subscription should use an outbound authenticated connection, resumable event cursors, bounded reconnect backoff, and queue reconciliation after a disconnect. A notification is only a wake-up hint: authorization, atomic claims, finite deadlines, and idempotent reply publication remain authoritative on the server.

Display authorization, worker activity, instruction compatibility, and verified reply delivery separately. A heartbeat or successful empty queue read is not a successful coaching round trip. If the host is offline, describe it honestly; use only the member's explicitly configured fallback behavior.

## Instruction updates versus software updates

Coaching instructions are bounded, versioned data fetched from the canonical Kata.fit origin and applied between requests. They must not execute downloaded code, widen plugin permissions, rewrite global agent instructions, or silently change data destinations. Plugin software updates remain under the host's normal release/install mechanism. Incompatible contracts must fail closed with a clear upgrade instruction.

## Release acceptance

- Real browser approval tested for personal owner and dojo chief; ordinary member denied.
- Cancellation, expiry, repeated approval, replay, brute-force limits, concurrent redemption, and authority changes tested.
- Revocation stops new claims; stale or late replies remain fenced.
- Restart behavior verified without leaking credentials or carrying one requester's context into another's.
- An authorized request/reply round trip is verified in Kata.fit itself.
- No new production infrastructure or environment requirement is introduced without an explicit deployment decision.
