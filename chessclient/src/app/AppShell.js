import Stack from "../shared/Stack";
import { useState } from "react";
import { Navigate, NavLink, Outlet, Link, useLocation } from "react-router-dom";
import {
  Box,
  Button,
  Typography,
  Alert,
  CircularProgress,
} from "@mui/material";
import { useRuntime } from "./RuntimeProvider";
import { request } from "../infrastructure/api";
import { matchUrl } from "../features/tournaments/model";
import { ErrorNotice } from "../shared/Status";
export default function AppShell() {
  const runtime = useRuntime(),
    location = useLocation(),
    [error, setError] = useState(null);
  const { auth, active, snapshot, connected, pending } = runtime;
  if (auth.isPending || (auth.isFetching && !auth.data))
    return (
      <Box sx={{ p: 6 }}>
        <CircularProgress size={24} /> Checking your session…
      </Box>
    );
  if (auth.error)
    return (
      <Box sx={{ p: 4 }}>
        <ErrorNotice error={auth.error} retry={auth.refetch} />
      </Box>
    );
  if (!auth.data)
    return (
      <Navigate to="/login" state={{ returnTo: location.pathname }} replace />
    );
  const logout = async () => {
    try {
      if (pending)
        throw new Error(
          "Resolve your pending game command before logging out.",
        );
      await request("/logout", { method: "POST" });
      window.dispatchEvent(new Event("chess:unauthenticated"));
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Box
        component="header"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          px: { xs: 2, md: 5 },
          py: 2,
          background: "rgba(8,13,18,.55)",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          flexWrap="wrap"
          gap={2}
          alignItems="stretch"
          justifyContent="space-between"
        >
          <Typography
            component={Link}
            to="/home"
            variant="h2"
            sx={{ textDecoration: "none", color: "text.primary" }}
          >
            ♞ Chess{" "}
            <Box component="span" sx={{ color: "primary.main" }}>
              Olympics
            </Box>
          </Typography>
          <Stack
            component="nav"
            aria-label="Main navigation"
            direction="row"
            sx={{ minWidth: 0, width: { xs: "100%", md: "auto" } }}
            gap={1}
            flexWrap="wrap"
          >
            {[
              ["/home", "Home"],
              ["/tournaments", "Tournaments"],
              ["/play", "Quick play"],
              ["/profile/rating", "Rating"],
            ].map(([to, title]) => (
              <Button
                component={NavLink}
                to={to}
                key={to}
                sx={{
                  color: "text.secondary",
                  "&.active": {
                    color: "primary.main",
                    background: "rgba(199,164,90,.1)",
                  },
                }}
              >
                {title}
              </Button>
            ))}
            <Button onClick={logout}>Logout</Button>
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {auth.data.name} ·{" "}
          {connected
            ? "Live connection established"
            : "Connecting to live games…"}
        </Typography>
      </Box>
      <Box sx={{ maxWidth: 1400, mx: "auto", px: { xs: 2, md: 5 }, py: 4 }}>
        <ErrorNotice error={error} />
        {!connected && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Live connection unavailable. Game actions are disabled until you
            reconnect.
          </Alert>
        )}
        {active && (
          <Alert
            severity={snapshot?.result ? "info" : "success"}
            sx={{ mb: 3 }}
            action={
              <Button
                component={Link}
                to={matchUrl(active.tournamentId, active.matchId)}
              >
                Return to match
              </Button>
            }
          >
            {snapshot?.result
              ? "Your match has ended. View the confirmed result."
              : `Tournament participation ${runtime.joined ? "confirmed" : "reconnecting"}. Navigation keeps your match connection open.`}
          </Alert>
        )}
        <Outlet />
      </Box>
    </Box>
  );
}
