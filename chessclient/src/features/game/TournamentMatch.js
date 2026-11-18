import Stack from "../../shared/Stack";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Skeleton,
} from "@mui/material";
import { useRuntime } from "../../app/RuntimeProvider";
import { request, tournamentPath } from "../../infrastructure/api";
import { dateTime, label } from "../tournaments/model";
import {
  TournamentTabs,
  useSubscription,
} from "../tournaments/TournamentPages";
import { Panel, Heading, Countdown, ErrorNotice } from "../../shared/Status";
import ChessBoard from "./ChessBoard";
const sq = (p) => String.fromCharCode(97 + p.col) + (p.row + 1);
export default function TournamentMatch() {
  const { tournamentId, matchId } = useParams(),
    runtime = useRuntime(),
    [error, setError] = useState(null),
    [confirm, setConfirm] = useState(null),
    [now, setNow] = useState(performance.now());
  const query = useQuery({
    queryKey: ["game", tournamentId, matchId],
    queryFn: ({ signal }) =>
      request(
        tournamentPath(tournamentId) +
          `/matches/${encodeURIComponent(matchId)}`,
        { signal },
      ),
    refetchInterval: 5000,
  });
  useSubscription(tournamentId);
  const active = runtime.active?.matchId === matchId;
  const snapshot =
    active && runtime.snapshot?.matchId === matchId
      ? runtime.snapshot
      : query.data;
  const [anchor, setAnchor] = useState(null);
  useEffect(() => {
    if (snapshot)
      setAnchor({
        serverNow: snapshot.serverNow,
        monotonic: performance.now(),
      });
  }, [snapshot]);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const estimated = anchor ? anchor.serverNow + now - anchor.monotonic : 0;
  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      setConfirm(null);
      query.refetch();
    } catch (e) {
      setError(e);
    }
  };
  if (!snapshot)
    return query.error ? (
      <ErrorNotice error={query.error} retry={query.refetch} />
    ) : (
      <Skeleton height={400} />
    );
  const s = snapshot,
    playing = s.status === "IN_PROGRESS" && !s.result,
    expired = estimated >= s.deadlineAt;
  const canMove =
    active &&
    runtime.joined &&
    runtime.connected &&
    !runtime.busy &&
    !runtime.pending &&
    playing &&
    !expired &&
    s.turn === s.side;
  const ownPoints = s.result?.[s.side + "Points"];
  return (
    <>
      <Heading
        title={
          s.result
            ? "Match result"
            : playing
              ? "Your tournament game"
              : "Match waiting room"
        }
        subtitle={`${s.players?.white?.displayName || "White"} vs ${s.players?.black?.displayName || "Black"} · You play ${s.side}`}
      />
      <TournamentTabs id={tournamentId} />
      <ErrorNotice
        error={error || query.error || (active ? runtime.error : null)}
        retry={() => (active ? runtime.sync() : query.refetch())}
      />
      {runtime.pending && active && (
        <Alert
          severity="warning"
          sx={{ my: 2 }}
          action={
            <Button
              disabled={!runtime.connected || runtime.busy}
              onClick={() => act(runtime.retryCommand)}
            >
              Resolve action
            </Button>
          }
        >
          Your last action is not yet resolved. Its original command ID will be
          reused safely.
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(0,1.5fr) minmax(280px,1fr)",
          },
          gap: 3,
          mt: 2,
        }}
      >
        <Panel>
          {s.result && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {ownPoints === 1
                ? "You won"
                : ownPoints === 0
                  ? "You lost"
                  : "Draw"}{" "}
              · {label(s.result.reason)} · {ownPoints} tournament points
            </Alert>
          )}
          <ChessBoard
            board={s.board}
            side={s.side}
            sequence={s.moveSequence}
            disabled={!canMove}
            onMove={(from, to) =>
              act(() => runtime.command({ type: "MOVE", from, to }))
            }
          />
        </Panel>
        <Stack gap={3}>
          <Panel>
            <Stack gap={2}>
              <Typography variant="h2">{label(s.status)}</Typography>
              <Typography>Scheduled start: {dateTime(s.startsAt)}</Typography>
              <Typography>Hard deadline: {dateTime(s.deadlineAt)}</Typography>
              <Countdown
                deadline={playing ? s.deadlineAt : s.startsAt}
                serverNow={s.serverNow}
                prefix={playing ? "Time remaining: " : "Starts in "}
              />
              {!s.result && !active && (
                <>
                  <Alert severity="info">
                    Opening this page does not count as attendance. Join before
                    the scheduled start.
                  </Alert>
                  <Button
                    variant="contained"
                    disabled={
                      !runtime.connected ||
                      runtime.busy ||
                      Boolean(runtime.active)
                    }
                    onClick={() =>
                      act(() => runtime.join({ tournamentId, matchId }))
                    }
                  >
                    Join waiting room / reconnect
                  </Button>
                  {runtime.active && (
                    <Typography color="text.secondary">
                      Leave your other match before joining this one.
                    </Typography>
                  )}
                </>
              )}
              {active && !s.result && (
                <Typography role="status">
                  {!runtime.connected
                    ? "Connection lost. Reconnecting…"
                    : !runtime.joined
                      ? "Attendance not confirmed. Reconnect before the cutoff."
                      : playing
                        ? s.turn === s.side
                          ? "Your turn"
                          : "Opponent’s turn"
                        : "Attendance confirmed. Stay connected until the round starts."}
                </Typography>
              )}
              {active && !s.result && !runtime.joined && (
                <Button
                  disabled={!runtime.connected || runtime.busy}
                  onClick={() =>
                    act(() => runtime.join({ tournamentId, matchId }))
                  }
                >
                  Reconnect to match
                </Button>
              )}
              {playing && expired && (
                <Alert severity="warning">
                  Deadline reached. Waiting for the server to confirm the
                  result.
                </Alert>
              )}
              {Object.entries(s.disconnects || {})
                .filter(([, d]) => d)
                .map(([side, d]) => (
                  <Alert severity="warning" key={side}>
                    {label(side)} disconnected.{" "}
                    <Countdown
                      deadline={d.deadlineAt}
                      serverNow={s.serverNow}
                      prefix="Reconnect window: "
                    />
                  </Alert>
                ))}
              {active && playing && (
                <>
                  <Stack direction="row" gap={1}>
                    <Button
                      disabled={
                        !runtime.connected ||
                        !runtime.joined ||
                        runtime.busy ||
                        Boolean(runtime.pending) ||
                        expired
                      }
                      onClick={() =>
                        act(() => runtime.command({ type: "OFFER_DRAW" }))
                      }
                    >
                      Offer draw
                    </Button>
                    <Button
                      color="error"
                      disabled={
                        !runtime.connected ||
                        !runtime.joined ||
                        runtime.busy ||
                        Boolean(runtime.pending) ||
                        expired
                      }
                      onClick={() => setConfirm("resign")}
                    >
                      Resign
                    </Button>
                  </Stack>
                  {s.drawOffer && (
                    <Alert severity="info">
                      {s.drawOffer === s.side
                        ? "You offered a draw."
                        : "Your opponent offered a draw."}
                      {s.drawOffer !== s.side && (
                        <Button
                          disabled={
                            !runtime.connected ||
                            !runtime.joined ||
                            runtime.busy ||
                            Boolean(runtime.pending) ||
                            expired
                          }
                          onClick={() =>
                            act(() => runtime.command({ type: "ACCEPT_DRAW" }))
                          }
                        >
                          Accept draw
                        </Button>
                      )}
                    </Alert>
                  )}
                </>
              )}
              {s.result && (
                <Typography>
                  {s.result.rating?.rated
                    ? `Rating ${s.result.rating[s.side]?.before} → ${s.result.rating[s.side]?.after} (${s.result.rating[s.side]?.delta >= 0 ? "+" : ""}${s.result.rating[s.side]?.delta})`
                    : `Unrated: ${label(s.result.rating?.excludedReason || "administrative result")}`}
                </Typography>
              )}
              {active && (
                <Button
                  disabled={
                    !runtime.connected ||
                    runtime.busy ||
                    Boolean(runtime.pending)
                  }
                  variant="outlined"
                  onClick={() =>
                    s.result ? act(runtime.leave) : setConfirm("leave")
                  }
                >
                  {s.result
                    ? "Close match participation"
                    : "Leave match connection"}
                </Button>
              )}
            </Stack>
          </Panel>
          <Panel>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Move journal
            </Typography>
            <Box sx={{ maxHeight: 260, overflowY: "auto" }}>
              {s.moves?.length ? (
                s.moves.map((m, i) => (
                  <Typography
                    key={i}
                    sx={{ py: 0.5, fontVariantNumeric: "tabular-nums" }}
                  >
                    {i + 1}. {i % 2 ? "Black" : "White"} · {sq(m.from)} →{" "}
                    {sq(m.to)}
                  </Typography>
                ))
              ) : (
                <Typography color="text.secondary">
                  No moves played yet.
                </Typography>
              )}
            </Box>
          </Panel>
        </Stack>
      </Box>
      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)}>
        <DialogTitle>
          {confirm === "resign"
            ? "Resign this game?"
            : "Leave your match connection?"}
        </DialogTitle>
        <DialogContent>
          {confirm === "resign"
            ? "Your opponent will receive a win."
            : "Leaving may cause a no-show or begin your reconnection countdown. It does not withdraw you from the tournament."}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            disabled={runtime.busy}
            onClick={() =>
              act(() =>
                confirm === "resign"
                  ? runtime.command({ type: "RESIGN" })
                  : runtime.leave(),
              )
            }
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
