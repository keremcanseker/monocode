/**
 * A sidebar click that should land on one subagent's row. The session may be
 * in a hidden tab or not mounted yet, so the request waits for its pane to
 * be visible and take it.
 */
type Reveal = { sessionId: string; blockId: string; at: number };

/**
 * A request is for the click that made it. One the session never got to (its
 * tab failed to open) must not scroll that session the next time it opens.
 */
const REVEAL_TTL_MS = 10_000;

let pending: Reveal | null = null;
const listeners = new Set<() => void>();

export function requestSubagentReveal(sessionId: string, blockId: string) {
  pending = { sessionId, blockId, at: Date.now() };
  for (const listener of listeners) listener();
}

/** The block to reveal in this session, if one is waiting. Consumes it. */
export function takeSubagentReveal(
  sessionId: string,
  now = Date.now(),
): string | null {
  if (pending && now - pending.at > REVEAL_TTL_MS) pending = null;
  if (pending?.sessionId !== sessionId) return null;
  const { blockId } = pending;
  pending = null;
  return blockId;
}

export function subscribeSubagentReveal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
