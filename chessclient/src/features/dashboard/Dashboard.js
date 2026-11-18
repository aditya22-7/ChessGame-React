import Stack from "../../shared/Stack";
import { Link } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  Box,
  Button,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Skeleton,
} from "@mui/material";
import { request, tournamentPath } from "../../infrastructure/api";
import { useRuntime } from "../../app/RuntimeProvider";
import {
  Panel,
  Heading,
  Empty,
  ErrorNotice,
  Countdown,
} from "../../shared/Status";
import { label, matchUrl } from "../tournaments/model";
export function useRating() {
  return useQuery({
    queryKey: ["rating"],
    queryFn: ({ signal }) => request("/players/me/rating", { signal }),
    refetchInterval: 30000,
  });
}
export function RatingPage() {
  const rating = useRating(),
    history = useQuery({
      queryKey: ["rating-history"],
      queryFn: ({ signal }) =>
        request("/players/me/rating-history?limit=100", { signal }),
    });
  return (
    <>
      <Heading
        title="Your rating"
        subtitle="Every eligible game, recorded by the server."
      />
      <ErrorNotice
        error={rating.error || history.error}
        retry={() => {
          rating.refetch();
          history.refetch();
        }}
      />
      <Panel>
        <Typography variant="h1" color="primary.main">
          {rating.data?.rating?.toLocaleString() ?? "—"}
        </Typography>
        <Typography color="text.secondary">
          {rating.data?.ratedGames ?? 0} rated games · {rating.data?.wins ?? 0}{" "}
          wins · {rating.data?.draws ?? 0} draws · {rating.data?.losses ?? 0}{" "}
          losses
        </Typography>
        <TableContainer sx={{ mt: 3 }}>
          <Table>
            <TableHead>
              <TableRow>
                {["Event", "Side", "Outcome", "Rating", "Change"].map((h) => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {history.data?.games.map((g) => (
                <TableRow key={g.gameId}>
                  <TableCell>{g.tournamentName || "Quick play"}</TableCell>
                  <TableCell>{label(g.side)}</TableCell>
                  <TableCell>
                    {g.score === 1 ? "Win" : g.score === 0 ? "Loss" : "Draw"}
                  </TableCell>
                  <TableCell>
                    {g.before} → {g.after}
                  </TableCell>
                  <TableCell
                    sx={{
                      color: g.delta >= 0 ? "secondary.main" : "error.light",
                    }}
                  >
                    {g.delta >= 0 ? "+" : ""}
                    {g.delta}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {!history.isPending && !history.data?.games.length && (
          <Empty>
            No rated games yet. Administrative results and games with
            insufficient play do not affect Elo.
          </Empty>
        )}
        <Typography variant="caption">
          Showing up to 100 most recent rated games.
        </Typography>
      </Panel>
    </>
  );
}
export default function Dashboard() {
  const { auth } = useRuntime(),
    rating = useRating();
  const tours = useQuery({
    queryKey: ["tournaments"],
    queryFn: ({ signal }) => request("/tournaments", { signal }),
    refetchInterval: 15000,
  });
  const memberships = useQueries({
    queries: (tours.data || []).map((t) => ({
      queryKey: ["participation", t.id],
      queryFn: ({ signal }) =>
        request(tournamentPath(t.id) + "/my-status", { signal }),
      staleTime: 10000,
      refetchInterval: 15000,
    })),
  });
  const assignments = memberships
    .flatMap((q, i) =>
      (q.data?.matches || [])
        .filter((m) => m.status !== "FINALIZED")
        .map((m) => ({
          ...m,
          tournament: tours.data[i],
          serverNow: q.data.serverNow,
        })),
    )
    .sort((a, b) => a.startsAt - b.startsAt);
  return (
    <>
      <Heading
        title={`Welcome, ${auth.data?.name || "player"}`}
        subtitle="Your next move begins here."
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" },
          gap: 3,
        }}
      >
        <Panel>
          <Typography variant="overline" color="secondary">
            Platform Elo
          </Typography>
          <Typography variant="h1" color="primary.main">
            {rating.data?.rating?.toLocaleString() ?? "—"}
          </Typography>
          <Typography color="text.secondary">
            {rating.data?.ratedGames ?? 0} rated games
          </Typography>
          <Button component={Link} to="/profile/rating">
            View history
          </Button>
          <ErrorNotice error={rating.error} retry={rating.refetch} />
        </Panel>
        <Panel>
          <Typography variant="h2">Quick play</Typography>
          <Typography color="text.secondary" sx={{ my: 2 }}>
            Find an opponent for a two-player game.
          </Typography>
          <Button component={Link} to="/play" variant="contained">
            Find a game
          </Button>
        </Panel>
        <Panel>
          <Typography variant="h2">Tournament hall</Typography>
          <Typography color="text.secondary" sx={{ my: 2 }}>
            Register, follow the fixed schedule, and compete round by round.
          </Typography>
          <Button component={Link} to="/tournaments" variant="outlined">
            Explore tournaments
          </Button>
        </Panel>
      </Box>
      <Typography variant="h2" sx={{ mt: 5, mb: 2 }}>
        Your upcoming matches
      </Typography>
      <ErrorNotice
        error={tours.error || memberships.find((q) => q.error)?.error}
        retry={() => {
          tours.refetch();
          memberships.forEach((q) => q.refetch());
        }}
      />
      {tours.isPending ? (
        <Skeleton height={100} />
      ) : (
        <Stack gap={2}>
          {assignments.map((m) => (
            <Panel key={m.matchId}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                gap={2}
              >
                <div>
                  <Typography variant="h3">
                    {m.tournament.name} · Round {m.roundNumber}
                  </Typography>
                  <Countdown
                    deadline={m.startsAt}
                    serverNow={m.serverNow}
                    prefix="Starts in "
                  />
                </div>
                <Button
                  component={Link}
                  to={matchUrl(m.tournament.id, m.matchId)}
                >
                  Open match
                </Button>
              </Stack>
            </Panel>
          ))}
        </Stack>
      )}
      {!tours.isPending && !assignments.length && (
        <Empty>
          No published assignments yet. Register for a tournament to take part.
        </Empty>
      )}
    </>
  );
}
