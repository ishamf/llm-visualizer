/**
 * Module-level pub-sub through which the cost charts ask a session's replay
 * to jump to a request. Keyed by session id: a chart emits for the session
 * it charts, and a replay listens only for the session it currently plays,
 * so charts never change which session a visualization replays. The
 * indirection is what makes the chart-replay connection plumbing-free —
 * chart and replay may be separate components or web elements on a page
 * that know nothing about each other beyond the session id.
 */

/** Jump request emitted by a cost chart click. */
export type RequestJump = {
  /** 1-based request number, matching the chart's bars and the request
   * list's labels. */
  request: number;
};

type JumpListener = (jump: RequestJump) => void;

/** Jump listeners per session id. Charts emit by session; each replay
 * registers under the session it is currently replaying. */
const listeners = new Map<string, Set<JumpListener>>();

/** Called by a chart when the user clicks one of its bars: every replay
 * currently listening for this session scrolls itself into view and seeks
 * to the request's time. Usually a single replay listens; if a host page
 * somehow shows several replays of the same session, each one follows. */
export function emitRequestJump(sessionId: string, jump: RequestJump): void {
  for (const listener of listeners.get(sessionId) ?? []) {
    listener(jump);
  }
}

/**
 * Subscribes `listener` to request jumps for `sessionId`. Returns an
 * unsubscribe function. The replay re-subscribes whenever its selected
 * session changes, which drops the old session's listener (the map entry
 * goes away with the last listener for that session).
 */
export function onRequestJump(
  sessionId: string,
  listener: JumpListener,
): () => void {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(sessionId);
    if (!current || !current.has(listener)) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(sessionId);
  };
}
