export const matchUrl = (tournamentId, matchId) =>
  `/tournaments/${tournamentId}/matches/${matchId}`;
export const label = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (s) => s.toUpperCase());
export const dateTime = (value) =>
  value == null
    ? "—"
    : new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
export function acceptSnapshot(current, incoming) {
  if (!current || current.matchId !== incoming.matchId) return incoming;
  if (
    (incoming.revision ?? 0) < (current.revision ?? 0) ||
    incoming.moveSequence < current.moveSequence
  )
    return current;
  if (current.result && !incoming.result) return current;
  return incoming;
}
export function coordinates(displayRow, displayCol, side) {
  return side === "black"
    ? { row: displayRow, col: 7 - displayCol }
    : { row: 7 - displayRow, col: displayCol };
}
export function remaining(deadline, anchor, now) {
  return Math.max(0, deadline - (anchor.serverNow + now - anchor.monotonic));
}
export function commandId() {
  return (
    window.crypto?.randomUUID?.() ||
    `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
export const finished = (status) =>
  ["COMPLETED", "FAILED", "CANCELLED"].includes(status);
