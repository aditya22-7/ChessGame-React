import Stack from "../../shared/Stack";
import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import { useRuntime } from "../../app/RuntimeProvider";
import { Panel, Heading, ErrorNotice } from "../../shared/Status";
import ChessBoard from "./ChessBoard";
export default function QuickPlay() {
  const { realtime, connected, active, refresh } = useRuntime(),
    socket = realtime.socket;
  const [game, setGame] = useState(null),
    [phase, setPhase] = useState("idle"),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const waiting = useRef(null),
    phaseRef = useRef("idle");
  phaseRef.current = phase;
  const ask = (event, payload, response) =>
    new Promise((resolve, reject) => {
      if (!socket.connected)
        return reject(new Error("Connection unavailable."));
      const timer = setTimeout(() => {
        waiting.current = null;
        reject(
          new Error(
            "The response was not received. Refresh the game state before acting again.",
          ),
        );
      }, 7000);
      waiting.current = {
        event: response,
        resolve: (value) => {
          clearTimeout(timer);
          waiting.current = null;
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          waiting.current = null;
          reject(error);
        },
      };
      socket.emit(event, payload);
    });
  useEffect(() => {
    const onData = (data) => {
      if (data.waiting) {
        setPhase("waiting");
        return;
      }
      setGame({ ...data, sequence: data.moveSequence ?? 0 });
      setPhase(data.result || data.status ? "finished" : "playing");
      setError(null);
      setBusy(false);
    };
    const onMove = (data) => {
      if (data.status) {
        setPhase("finished");
        refresh();
      }
      setGame((g) =>
        g
          ? {
              ...g,
              board: Array.isArray(data) ? data : data.board,
              freeze: Boolean(data.status),
              status: data.status,
              sequence: g.sequence + 1,
            }
          : g,
      );
    };
    const handlers = {
      getdata: onData,
      move: onMove,
      from: (value) =>
        waiting.current?.event === "from" && waiting.current.resolve(value),
      to: (value) =>
        waiting.current?.event === "to" && waiting.current.resolve(value),
      left: () => {
        waiting.current?.event === "left" && waiting.current.resolve(true);
        setGame(null);
        setPhase("idle");
      },
      playerleft: () => {
        setPhase("finished");
        setGame((g) => (g ? { ...g, freeze: true, left: true } : g));
      },
      disconnect: () => {
        waiting.current?.reject(
          new Error(
            "Connection lost. Quick-play sessions cannot be resumed after disconnection.",
          ),
        );
        setPhase("interrupted");
        setBusy(false);
      },
      "quickplay:error": (e) => {
        setError(new Error(e.code || "Unable to join quick play."));
        setPhase("idle");
      },
    };
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
    return () => {
      waiting.current?.reject(new Error("Quick-play screen closed."));
      if (
        socket.connected &&
        ["waiting", "playing", "uncertain", "finished"].includes(
          phaseRef.current,
        )
      )
        socket.emit("leavegame");
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn);
    };
  }, [socket, refresh]);
  useEffect(() => {
    if (!["waiting", "playing", "uncertain"].includes(phase)) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);
  const act = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const move = async (from, to) => {
    if (busy || !connected || phase !== "playing") return;
    setBusy(true);
    await act(async () => {
      const permitted = await ask("pt", from, "from");
      if (
        !Array.isArray(permitted) ||
        !permitted.some((p) => p.row === to.row && p.col === to.col)
      )
        throw new Error("That move is not permitted.");
      let response;
      try {
        response = await ask("to", to, "to");
      } catch (e) {
        setPhase("uncertain");
        throw e;
      }
      if (response === "invalid")
        throw new Error("Move rejected. Select your piece again.");
      setGame((g) => ({
        ...g,
        board: Array.isArray(response) ? response : response.board,
        freeze: true,
        status: response.status,
        sequence: g.sequence + 1,
      }));
      if (response.status) {
        setPhase("finished");
        refresh();
      }
    });
  };
  return (
    <>
      <Heading
        title="Quick play"
        subtitle="Two players. One board. Your next challenge."
      />
      <ErrorNotice error={error} />
      {["playing", "uncertain"].includes(phase) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Leaving this screen ends your quick-play connection and may forfeit
          the game.
        </Alert>
      )}
      {active && (
        <Alert severity="warning">
          Close your tournament participation before starting quick play.
        </Alert>
      )}
      {!game ? (
        <Panel>
          <Stack gap={2}>
            <Typography variant="h2">
              {phase === "waiting"
                ? "Finding your opponent…"
                : phase === "interrupted"
                  ? "Connection interrupted"
                  : "Ready to play?"}
            </Typography>
            <Typography color="text.secondary">
              Quick-play sessions cannot resume after a refresh or lost
              connection. Eligible games between different signed-in players
              affect Elo.
            </Typography>
            <Button
              variant="contained"
              disabled={!connected || Boolean(active) || phase === "waiting"}
              onClick={() => {
                setPhase("waiting");
                setError(null);
                socket.emit("newgame", "player");
              }}
            >
              Find a game
            </Button>
            {phase === "waiting" && (
              <Button
                disabled={!connected || busy}
                onClick={() => act(() => ask("leavegame", undefined, "left"))}
              >
                Cancel search
              </Button>
            )}
          </Stack>
        </Panel>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "1.5fr 1fr" },
            gap: 3,
          }}
        >
          <Panel>
            <ChessBoard
              board={game.board}
              side={game.side}
              sequence={game.sequence}
              disabled={
                !connected ||
                busy ||
                game.freeze ||
                phase !== "playing" ||
                Boolean(game.status)
              }
              onMove={move}
            />
          </Panel>
          <Panel>
            <Stack gap={2}>
              <Typography variant="h2">
                Playing {game.name || "opponent"}
              </Typography>
              <Typography>
                You play {game.side} ·{" "}
                {game.rated ? "Eligible for rating" : "Unrated pairing"}
              </Typography>
              <Typography role="status">
                {game.left
                  ? "Opponent left the game."
                  : game.status
                    ? `${game.status} wins`
                    : phase === "interrupted"
                      ? "Connection lost. This game cannot be resumed."
                      : phase === "uncertain"
                        ? "Action unresolved. Refresh the authoritative board."
                        : game.freeze
                          ? "Waiting for opponent"
                          : "Your turn"}
              </Typography>
              {phase === "uncertain" && (
                <Button
                  disabled={!connected}
                  onClick={() => socket.emit("getdata")}
                >
                  Refresh game state
                </Button>
              )}
              <Button
                variant="outlined"
                disabled={!connected || busy}
                onClick={() => act(() => ask("leavegame", undefined, "left"))}
              >
                {game.status || game.left
                  ? "Close game"
                  : "Leave game (forfeit)"}
              </Button>
            </Stack>
          </Panel>
        </Box>
      )}
    </>
  );
}
