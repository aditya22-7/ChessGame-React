import DataProvider from "../features/game/GameProvider";
import { Routes, Route } from "react-router-dom";
import Game from "../features/game/Game";
import Welcome from "../features/auth/pages/Welcome";
import LoginProvider from "../features/auth/LoginProvider";
import LoginAuth from "../features/auth/guards/LoginAuth";
import { BrowserRouter as Router } from "react-router-dom";
import LoaderText from "../components/LoaderText";
import GameAuth from "../features/auth/guards/GameAuth";
import FailureAuth from "../features/auth/guards/FailureAuth";
import { Suspense } from "react";
import NewGameAuth from "../features/auth/guards/NewGameAuth";
import { CssBaseline } from "@mui/material";
import PageBackground from "../components/PageBackground";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme";
import RuntimeProvider from "./RuntimeProvider";
import AppShell from "./AppShell";
import Dashboard, { RatingPage } from "../features/dashboard/Dashboard";
import {
  TournamentDirectory,
  TournamentDetails,
  RoundsPage,
  StandingsPage,
  MyMatchesPage,
} from "../features/tournaments/TournamentPages";
import TournamentMatch from "../features/game/TournamentMatch";
import QuickPlay from "../features/game/QuickPlay";
import { Navigate } from "react-router-dom";
import AppErrorBoundary from "./AppErrorBoundary";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !error.status && count < 1,
      staleTime: 5000,
    },
    mutations: { retry: false },
  },
});

export default function App() {
  return (
    <LoginProvider>
      <Router>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider theme={theme}>
            <RuntimeProvider>
              <CssBaseline />
              <PageBackground>
                <AppErrorBoundary>
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="/home" element={<Dashboard />} />
                      <Route path="/play" element={<QuickPlay />} />
                      <Route path="/play/quick" element={<QuickPlay />} />
                      <Route path="/profile/rating" element={<RatingPage />} />
                      <Route
                        path="/tournaments"
                        element={<TournamentDirectory />}
                      />
                      <Route
                        path="/tournaments/:tournamentId"
                        element={<TournamentDetails />}
                      />
                      <Route
                        path="/tournaments/:tournamentId/rounds"
                        element={<RoundsPage />}
                      />
                      <Route
                        path="/tournaments/:tournamentId/standings"
                        element={<StandingsPage />}
                      />
                      <Route
                        path="/tournaments/:tournamentId/my-status"
                        element={<MyMatchesPage />}
                      />
                      <Route
                        path="/tournaments/:tournamentId/matches/:matchId"
                        element={<TournamentMatch />}
                      />
                    </Route>
                    <Route path="*" element={<Navigate to="/home" replace />} />
                    <Route path="/" element={<Welcome />} />
                    <Route
                      path="/login"
                      element={
                        <Suspense
                          fallback={<LoaderText text="Loading, Please Wait" />}
                        >
                          <LoginAuth />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/failed"
                      element={
                        <Suspense
                          fallback={<LoaderText text="Loading, Please Wait" />}
                        >
                          <FailureAuth />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/newgame"
                      element={
                        <Suspense
                          fallback={<LoaderText text="Loading, Please Wait" />}
                        >
                          <NewGameAuth />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/game"
                      element={
                        <GameAuth>
                          <DataProvider>
                            <Game />
                          </DataProvider>
                        </GameAuth>
                      }
                    />
                  </Routes>
                </AppErrorBoundary>
              </PageBackground>
            </RuntimeProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </Router>
    </LoginProvider>
  );
}
