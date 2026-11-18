import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { session, ApiError } from "../infrastructure/api";
import { createRealtime } from "../infrastructure/realtime";
import { acceptSnapshot, commandId } from "../features/tournaments/model";
const Runtime = createContext(null);
export const useRuntime = () => useContext(Runtime);
function readRecord(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}
function writeRecord(key, value) {
  try {
    value
      ? sessionStorage.setItem(key, JSON.stringify(value))
      : sessionStorage.removeItem(key);
  } catch {
    /* Recovery storage may be unavailable; live play still works. */
  }
}
export default function RuntimeProvider({ children }) {
  const location = useLocation(),
    cache = useQueryClient();
  const publicPage = ["/", "/login", "/failed"].includes(location.pathname);
  const auth = useQuery({
    queryKey: ["session"],
    queryFn: session,
    enabled: !publicPage,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const [realtime] = useState(createRealtime),
    [connected, setConnected] = useState(false);
  const [active, setActiveState] = useState(null),
    activeRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null),
    snapshotRef = useRef(null);
  const [pending, setPendingState] = useState(null),
    pendingRef = useRef(null);
  const [busy, setBusy] = useState(false),
    [joined, setJoined] = useState(false),
    [error, setError] = useState(null);
  const subscribed = useRef(new Map()),
    chain = useRef(Promise.resolve()),
    anchor = useRef(null),
    userRef = useRef(null),
    joining = useRef(false),
    identity = useRef(null);
  userRef.current = auth.data;
  const storageKey = () => `chess:participation:${userRef.current?.playerId}`;
  const persist = () =>
    writeRecord(
      storageKey(),
      activeRef.current
        ? { ...activeRef.current, pending: pendingRef.current }
        : null,
    );
  const setActive = (value) => {
    activeRef.current = value;
    setActiveState(value);
  };
  const setPending = (value) => {
    pendingRef.current = value;
    setPendingState(value);
    persist();
  };
  const apply = useCallback((value) => {
    const accepted = acceptSnapshot(snapshotRef.current, value);
    if (accepted === value) {
      snapshotRef.current = value;
      setSnapshot(value);
      anchor.current = {
        serverNow: value.serverNow,
        monotonic: performance.now(),
      };
    }
    return accepted;
  }, []);
  const sync = useCallback(() => {
    const target = activeRef.current;
    if (!target || !realtime.socket.connected) return Promise.resolve();
    const task = chain.current
      .catch(() => {})
      .then(async () => {
        const value = await realtime.send("game:sync", target);
        if (activeRef.current?.matchId === target.matchId) apply(value);
        return value;
      });
    chain.current = task;
    return task;
  }, [realtime, apply]);
  const refresh = useCallback(
    (id) => {
      for (const key of ["tournament", "participation", "standings"])
        cache.invalidateQueries({ queryKey: id ? [key, id] : [key] });
      cache.invalidateQueries({ queryKey: ["tournaments"] });
      cache.invalidateQueries({ queryKey: ["rating"] });
      cache.invalidateQueries({ queryKey: ["rating-history"] });
    },
    [cache],
  );
  const join = async (target) => {
    if (joining.current || pendingRef.current)
      throw new ApiError(
        "ACTION_PENDING",
        "Resolve the pending game command before joining another match.",
      );
    if (activeRef.current && activeRef.current.matchId !== target.matchId)
      throw new ApiError(
        "ALREADY_PLAYING",
        "Leave your current match before joining another.",
      );
    const previousTarget = activeRef.current;
    setActive(target);
    persist();
    joining.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await realtime.send("game:join", target);
      setActive(target);
      persist();
      setJoined(true);
      apply(value);
      refresh(target.tournamentId);
      return value;
    } catch (e) {
      if (
        !previousTarget &&
        ![
          "ACK_TIMEOUT",
          "DATABASE_UNAVAILABLE",
          "COMMIT_OUTCOME_UNKNOWN",
          "OFFLINE",
          "SERVER_STOPPING",
        ].includes(e.code)
      ) {
        setActive(null);
        persist();
      }
      setError(e);
      throw e;
    } finally {
      joining.current = false;
      setBusy(false);
    }
  };
  const leave = async () => {
    if (pendingRef.current)
      throw new ApiError(
        "ACTION_PENDING",
        "Resolve the pending command before leaving.",
      );
    setBusy(true);
    try {
      await realtime.send("game:leave", {});
      setActive(null);
      setJoined(false);
      snapshotRef.current = null;
      setSnapshot(null);
      persist();
    } finally {
      setBusy(false);
    }
  };
  const resolveCommand = async (record) => {
    setBusy(true);
    setError(null);
    try {
      const value = await realtime.send("game:command", {
        ...record.target,
        command: record.command,
      });
      if (activeRef.current?.matchId === record.target.matchId) apply(value);
      setPending(null);
      refresh(record.target.tournamentId);
      await sync();
      return value;
    } catch (e) {
      if (
        ![
          "ACK_TIMEOUT",
          "DATABASE_UNAVAILABLE",
          "COMMIT_OUTCOME_UNKNOWN",
          "OFFLINE",
          "SERVER_STOPPING",
        ].includes(e.code)
      )
        setPending(null);
      setError(e);
      await sync().catch(() => {});
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const command = async (action) => {
    if (pendingRef.current || busy)
      throw new ApiError("ACTION_PENDING", "Wait for the previous action.");
    if (!activeRef.current || !joined || !realtime.socket.connected)
      throw new ApiError("OFFLINE", "Join the game before acting.");
    const s = snapshotRef.current,
      a = anchor.current;
    if (!s || s.status !== "IN_PROGRESS" || s.result)
      throw new ApiError("MATCH_OVER", "This match is not in progress.");
    if (a && a.serverNow + performance.now() - a.monotonic >= s.deadlineAt) {
      await sync();
      throw new ApiError(
        "MATCH_DEADLINE",
        "Waiting for the server to confirm the deadline result.",
      );
    }
    const record = {
      target: activeRef.current,
      command: {
        ...action,
        expectedMoveSequence: s.moveSequence,
        commandId: commandId(),
      },
    };
    setPending(record);
    return resolveCommand(record);
  };
  const subscribe = useCallback(
    (id) => {
      const counts = subscribed.current;
      counts.set(id, (counts.get(id) || 0) + 1);
      if (realtime.socket.connected)
        realtime
          .send("tournament:subscribe", { tournamentId: id })
          .then(() => refresh(id))
          .catch(setError);
      return () => {
        const count = (counts.get(id) || 1) - 1;
        if (count) counts.set(id, count);
        else {
          counts.delete(id);
          if (
            activeRef.current?.tournamentId !== id &&
            realtime.socket.connected
          )
            realtime
              .send("tournament:unsubscribe", { tournamentId: id })
              .catch(() => {});
        }
      };
    },
    [realtime, refresh],
  );
  useEffect(() => {
    const user = userRef.current;
    if (
      (!user && !publicPage) ||
      (identity.current && user && identity.current !== user.playerId)
    ) {
      setActive(null);
      snapshotRef.current = null;
      setSnapshot(null);
      pendingRef.current = null;
      setPendingState(null);
      setError(null);
      cache.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    }
    identity.current = user?.playerId ?? null;
    if (!user || publicPage) {
      realtime.socket.disconnect();
      setConnected(false);
      setJoined(false);
      return;
    }
    const record = readRecord(`chess:participation:${user.playerId}`);
    if (!activeRef.current && record?.matchId && record?.tournamentId) {
      setActive({ tournamentId: record.tournamentId, matchId: record.matchId });
      pendingRef.current = record.pending ?? null;
      setPendingState(record.pending ?? null);
    }
    const onConnect = async () => {
      setConnected(true);
      refresh();
      try {
        const ids = new Set(
          [
            ...subscribed.current.keys(),
            activeRef.current?.tournamentId,
          ].filter(Boolean),
        );
        for (const id of ids)
          await realtime.send("tournament:subscribe", { tournamentId: id });
        const target = activeRef.current;
        if (target) {
          const state = await realtime.send("game:sync", target);
          apply(state);
          if (!state.result) {
            const joinedState = await realtime.send("game:join", target);
            if (activeRef.current?.matchId === target.matchId) {
              apply(joinedState);
              setJoined(true);
            }
          }
        }
      } catch (e) {
        setError(e);
        await sync().catch(() => {});
      }
    };
    const onDisconnect = () => {
      setConnected(false);
      setJoined(false);
    };
    const seen = new Set();
    const onEvent = (event) => {
      if (!event?.eventId || seen.has(event.eventId)) return;
      seen.add(event.eventId);
      if (seen.size > 500) seen.delete(seen.values().next().value);
      refresh(event.tournamentId);
      if (activeRef.current?.tournamentId === event.tournamentId)
        sync().catch(setError);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        sync().catch(setError);
      }
    };
    realtime.socket
      .on("connect", onConnect)
      .on("disconnect", onDisconnect)
      .on("tournament:event", onEvent);
    document.addEventListener("visibilitychange", onVisibility);
    realtime.socket.connect();
    const poll = setInterval(() => sync().catch(setError), 5000);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      realtime.socket
        .off("connect", onConnect)
        .off("disconnect", onDisconnect)
        .off("tournament:event", onEvent);
      realtime.socket.disconnect();
    };
  }, [auth.data?.playerId, publicPage, realtime, refresh, sync, apply, cache]); // Keep attendance across protected route changes.
  useEffect(() => {
    const expire = () => {
      cache.cancelQueries();
      realtime.socket.disconnect();
      setActive(null);
      snapshotRef.current = null;
      setSnapshot(null);
      pendingRef.current = null;
      setPendingState(null);
      cache.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      cache.setQueryData(["session"], null);
    };
    window.addEventListener("chess:unauthenticated", expire);
    return () => window.removeEventListener("chess:unauthenticated", expire);
  }, [cache, realtime]);
  return (
    <Runtime.Provider
      value={{
        auth,
        connected,
        active,
        snapshot,
        pending,
        busy,
        joined,
        error,
        join,
        leave,
        command,
        retryCommand: () =>
          pendingRef.current
            ? resolveCommand(pendingRef.current)
            : Promise.resolve(),
        sync,
        subscribe,
        refresh,
        realtime,
      }}
    >
      {children}
    </Runtime.Provider>
  );
}
