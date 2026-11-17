import Stack from "../../shared/Stack";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Skeleton,
} from "@mui/material";
import { request, tournamentPath } from "../../infrastructure/api";
import { useRuntime } from "../../app/RuntimeProvider";
import { useTournament, useMine, useStandings } from "./hooks";
import { label, dateTime, matchUrl, finished } from "./model";
import {
  Countdown,
  Empty,
  ErrorNotice,
  Heading,
  Panel,
} from "../../shared/Status";
function Badge({ status }) {
  return (
    <Chip
      size="small"
      label={label(status)}
      color={status === "IN_PROGRESS" ? "secondary" : "default"}
      variant="outlined"
    />
  );
}
export function useSubscription(id) {
  const { subscribe } = useRuntime();
  useEffect(() => subscribe(id), [id, subscribe]);
}
export function TournamentDirectory() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["tournaments"],
    queryFn: ({ signal }) => request("/tournaments", { signal }),
    refetchInterval: 15000,
  });
  const rows = (query.data || []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Tournaments"
        subtitle="A shared stage. A new challenge every round."
      />
      <TextField
        label="Search tournaments"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
        sx={{ mb: 3 }}
      />
      <ErrorNotice error={query.error} retry={query.refetch} />
      {query.isPending ? (
        <Skeleton height={150} />
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(2,1fr)" },
            gap: 3,
          }}
        >
          {rows.map((t) => (
            <Panel key={t.id}>
              <Stack gap={2}>
                <Badge status={t.status} />
                <Typography variant="h2">{t.name}</Typography>
                <Typography color="text.secondary">
                  Swiss · {t.totalRounds} rounds · {t.entrantCount}/
                  {t.maxEntrants} registered
                </Typography>
                <Typography>
                  First round: {dateTime(t.rounds[0]?.startsAt)}
                </Typography>
                {t.status === "REGISTRATION_OPEN" && (
                  <Countdown
                    deadline={t.registrationClosesAt}
                    serverNow={t.serverNow}
                    prefix="Registration closes in "
                  />
                )}
                <Button
                  component={Link}
                  to={`/tournaments/${t.id}`}
                  variant="outlined"
                >
                  View tournament
                </Button>
              </Stack>
            </Panel>
          ))}
        </Box>
      )}
      {!query.isPending && !query.error && !rows.length && (
        <Empty>
          No tournaments found. New events will appear here when published.
        </Empty>
      )}
    </>
  );
}
export function TournamentDetails() {
  const { tournamentId: id } = useParams(),
    tour = useTournament(id),
    mine = useMine(id),
    runtime = useRuntime(),
    cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  useSubscription(id);
  const registration = useMutation({
    mutationFn: (withdraw) =>
      request(
        tournamentPath(id) +
          (withdraw ? "/registrations/me" : "/registrations"),
        { method: withdraw ? "DELETE" : "POST" },
      ),
    onSuccess: () => {
      setConfirm(false);
      runtime.refresh(id);
      cache.invalidateQueries({ queryKey: ["participation", id] });
    },
  });
  if (tour.isPending) return <Skeleton height={220} />;
  if (!tour.data)
    return <ErrorNotice error={tour.error} retry={tour.refetch} />;
  const t = tour.data,
    entrant = mine.data?.entrant;
  const assignment = mine.data?.matches.find((m) => m.status !== "FINALIZED");
  return (
    <>
      <Heading
        title={t.name}
        subtitle={`${label(t.format)} · ${t.totalRounds} fixed rounds`}
        action={<Badge status={t.status} />}
      />
      <TournamentTabs id={id} />
      <ErrorNotice
        error={tour.error || mine.error || registration.error}
        retry={() => {
          tour.refetch();
          mine.refetch();
        }}
      />
      {t.failure && (
        <Alert severity="error" sx={{ my: 2 }}>
          Tournament stopped: {label(t.failure.code)}. Published times have not
          been shifted.
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 3,
        }}
      >
        <Panel>
          <Stack gap={2}>
            <Typography variant="h2">Your participation</Typography>
            {mine.isPending ? (
              <Skeleton />
            ) : entrant ? (
              <>
                <Badge status={entrant.status} />
                <Typography>
                  Registration: {dateTime(entrant.registeredAt)}
                </Typography>
                {entrant.status === "REGISTERED" && !finished(t.status) && (
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => setConfirm(true)}
                  >
                    Withdraw permanently
                  </Button>
                )}
              </>
            ) : (
              <>
                <Typography color="text.secondary">
                  Register to receive a round assignment. Initial seeding is
                  random.
                </Typography>
                <Button
                  variant="contained"
                  disabled={
                    registration.isPending ||
                    t.status !== "REGISTRATION_OPEN" ||
                    Boolean(mine.error)
                  }
                  onClick={() => registration.mutate(false)}
                >
                  Register for tournament
                </Button>
              </>
            )}
            {registration.isPending && (
              <Typography>Saving your registration…</Typography>
            )}
            {assignment && (
              <Button
                component={Link}
                to={matchUrl(id, assignment.matchId)}
                variant="contained"
              >
                Open Round {assignment.roundNumber} waiting room
              </Button>
            )}
            {entrant?.status === "REGISTERED" &&
              !assignment &&
              !finished(t.status) && (
                <Typography color="text.secondary">
                  Your next pairing will appear after publication.
                </Typography>
              )}
            {mine.data?.nextRoundStartsAt && (
              <Countdown
                deadline={mine.data.nextRoundStartsAt}
                serverNow={mine.data.serverNow}
                prefix="Next round in "
              />
            )}
          </Stack>
        </Panel>
        <Panel>
          <Stack gap={2}>
            <Typography variant="h2">Event rules</Typography>
            <Typography>
              {t.entrantCount} of {t.maxEntrants} places filled
            </Typography>
            <Typography>
              Registration closes {dateTime(t.registrationClosesAt)}
            </Typography>
            {t.status === "REGISTRATION_OPEN" && (
              <Countdown
                deadline={t.registrationClosesAt}
                serverNow={t.serverNow}
              />
            )}
            <Typography color="text.secondary">
              Join your assigned match before its scheduled start. A single
              absence loses; double absence draws. Unfinished matches become
              draws at the hard deadline. Withdrawal is permanent. Requested
              byes are unavailable.
            </Typography>
            <Typography color="text.secondary">
              Games use the current platform king-capture ruleset. Rating
              changes apply only to eligible played games.
            </Typography>
          </Stack>
        </Panel>
      </Box>
      <Dialog
        open={confirm}
        onClose={() => !registration.isPending && setConfirm(false)}
      >
        <DialogTitle>Withdraw from this tournament?</DialogTitle>
        <DialogContent>
          Withdrawal is permanent. You cannot register again, and opponents in
          your published unfinished matches receive a win.
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirm(false)}
            disabled={registration.isPending}
          >
            Stay registered
          </Button>
          <Button
            color="error"
            onClick={() => registration.mutate(true)}
            disabled={registration.isPending}
          >
            Withdraw permanently
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
export function TournamentTabs({ id }) {
  return (
    <Stack
      component="nav"
      aria-label="Tournament navigation"
      direction="row"
      gap={1}
      flexWrap="wrap"
      sx={{ mb: 3 }}
    >
      {[
        ["", "Overview"],
        ["/rounds", "Rounds"],
        ["/standings", "Standings"],
        ["/my-status", "My matches"],
      ].map(([suffix, title]) => (
        <Button
          component={Link}
          key={suffix}
          to={`/tournaments/${id}${suffix}`}
        >
          {title}
        </Button>
      ))}
    </Stack>
  );
}
export function RoundsPage() {
  const { tournamentId: id } = useParams(),
    tour = useTournament(id),
    mine = useMine(id);
  useSubscription(id);
  const [params, setParams] = useSearchParams();
  if (!tour.data)
    return tour.error ? (
      <ErrorNotice error={tour.error} retry={tour.refetch} />
    ) : (
      <Skeleton height={200} />
    );
  const t = tour.data,
    index = Math.max(
      0,
      Math.min(t.rounds.length - 1, (Number(params.get("round")) || 1) - 1),
    ),
    round = t.rounds[index];
  const names = Object.fromEntries(
    (t.entrants || []).map((e) => [e.entrantId, e.displayName]),
  );
  return (
    <>
      <Heading title="Round schedule" subtitle={t.name} />
      <TournamentTabs id={id} />
      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 3 }}>
        {t.rounds.map((r) => (
          <Button
            key={r.id}
            variant={r.id === round.id ? "contained" : "outlined"}
            onClick={() => setParams({ round: String(r.number) })}
          >
            Round {r.number}
          </Button>
        ))}
      </Stack>
      <Panel>
        <Stack gap={2}>
          <Typography variant="h2">Round {round.number}</Typography>
          <Badge status={round.status} />
          <Typography>
            Starts {dateTime(round.startsAt)} · Deadline{" "}
            {dateTime(round.endsAt)}
          </Typography>
          <Countdown
            deadline={round.startsAt}
            serverNow={t.serverNow}
            prefix="Starts in "
          />
          {round.failure && (
            <Alert severity="error">{label(round.failure.code)}</Alert>
          )}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {["Board", "White", "Black", "Result", ""].map((h) => (
                    <TableCell key={h}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {round.matches.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.boardNumber}</TableCell>
                    <TableCell>{names[m.whiteEntrantId] || "Player"}</TableCell>
                    <TableCell>{names[m.blackEntrantId] || "Player"}</TableCell>
                    <TableCell>
                      {m.result
                        ? `${label(m.result.outcome)} · ${label(m.result.reason)}`
                        : label(m.status)}
                    </TableCell>
                    <TableCell>
                      {mine.data?.matches.some((a) => a.matchId === m.id) && (
                        <Button component={Link} to={matchUrl(id, m.id)}>
                          Open match
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {!round.matches.length && (
            <Empty>Pairings have not been published.</Empty>
          )}
          {round.awards.map((a) => (
            <Typography key={a.entrantId}>
              {names[a.entrantId] || "Player"} · {label(a.type)} · {a.points}{" "}
              points
            </Typography>
          ))}
        </Stack>
      </Panel>
    </>
  );
}
export function StandingsPage() {
  const { tournamentId: id } = useParams(),
    tour = useTournament(id),
    standings = useStandings(id);
  useSubscription(id);
  const names = Object.fromEntries(
    (tour.data?.entrants || []).map((e) => [e.entrantId, e.displayName]),
  );
  return (
    <>
      <Heading title="Standings" subtitle={tour.data?.name} />
      <TournamentTabs id={id} />
      <ErrorNotice
        error={standings.error || tour.error}
        retry={() => {
          standings.refetch();
          tour.refetch();
        }}
      />
      <Panel>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {[
                  "Rank",
                  "Player",
                  "Score",
                  "Buchholz",
                  "Sonneborn–Berger",
                  "Played wins",
                  "Status",
                ].map((h) => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {standings.data?.map((r) => (
                <TableRow key={r.entrantId}>
                  <TableCell>{r.rank}</TableCell>
                  <TableCell>{names[r.entrantId] || r.playerId}</TableCell>
                  <TableCell sx={{ color: "primary.main", fontWeight: 700 }}>
                    {r.score}
                  </TableCell>
                  <TableCell>{r.buchholz}</TableCell>
                  <TableCell>{r.sonnebornBerger}</TableCell>
                  <TableCell>{r.playedWins}</TableCell>
                  <TableCell>{label(r.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {standings.isPending ? (
          <Skeleton />
        ) : (
          !standings.data?.length && <Empty>No registered players yet.</Empty>
        )}
        <Typography variant="caption" color="text.secondary">
          Official ranks and tie-break values are calculated by the server.
          Equal ranks are preserved.
        </Typography>
      </Panel>
    </>
  );
}
export function MyMatchesPage() {
  const { tournamentId: id } = useParams(),
    mine = useMine(id);
  useSubscription(id);
  return (
    <>
      <Heading title="My matches" />
      <TournamentTabs id={id} />
      <ErrorNotice error={mine.error} retry={mine.refetch} />
      <Stack gap={2}>
        {mine.data?.matches.map((m) => (
          <Panel key={m.matchId}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              gap={2}
              justifyContent="space-between"
            >
              <div>
                <Typography variant="h2">Round {m.roundNumber}</Typography>
                <Typography>{dateTime(m.startsAt)}</Typography>
                <Typography color="text.secondary">
                  {m.result
                    ? `${label(m.result.outcome)} · ${label(m.result.reason)}`
                    : label(m.status)}
                </Typography>
              </div>
              <Button
                component={Link}
                to={matchUrl(id, m.matchId)}
                variant="outlined"
              >
                {m.result ? "View result" : "Open waiting room"}
              </Button>
            </Stack>
          </Panel>
        ))}
      </Stack>
      {mine.isPending ? (
        <Skeleton />
      ) : (
        !mine.data?.matches.length && (
          <Empty>
            No assignments yet. Register and wait for pairings to be published.
          </Empty>
        )
      )}
    </>
  );
}
