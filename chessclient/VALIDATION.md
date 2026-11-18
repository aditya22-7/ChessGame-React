# Frontend integration validation

Validated on 2026-11-17 using the production React build, headless Microsoft Edge, and an isolated MySQL Community Server 8.4.13 instance. Existing user databases and account files were not imported or changed.

## Passing checks

- Strict production build: `CI=true npm run build`.
- Frontend tests: **10 passed across five suites**. Covers the welcome screen, real rating/error displays, absolute countdown calculation, board coordinates/keyboard behavior, disabled moves, stale-snapshot protection, and retaining/retrying an unresolved command with the same identity.
- Backend regression/transaction tests: **53 passed**.
- SQL backend integration suite: **24 passed** against a separate disposable `chess_integration` schema.
- Real browser/SQL integration: **four passed**, with two independent authenticated browser contexts where applicable.
- Generated database schema consistency and `git diff --check` passed.

## Browser flows

1. Login through the actual form; register two users; receive pairings; join both waiting rooms; browse rounds without losing attendance; exchange accepted moves. Simulate a committed move whose response reports an uncertain outcome, allow the opponent's next move, then resolve the original command without regressing the board. Refresh and rejoin; force a transport disconnect and recover; resign; display the SQL-backed result and standings.
2. Start an attended match, advance the authoritative clock to its fixed hard deadline, display the confirmed draw, close participation, logout, verify `/session` returns 401, and verify protected routes redirect to login.
3. Register and permanently withdraw through the confirmation dialog. Verify no re-entry button appears. Check a 390px viewport, including bounds of every main-navigation item.
4. Pair two authenticated quick-play clients, exchange a committed move through the shared board, and leave the game with the opponent receiving the leave state.

Desktop standings, tournament board, and mobile screenshots were visually inspected. Review caught and fixed global legacy board styles affecting data tables and unsupported layout props clipping mobile navigation. Screenshots/traces are available under ignored `test-results/` when the suite is run.

The browser suite uses a controlled backend clock to test fixed schedules without waiting for real tournament durations. This is not a production load test. The current engine's king-capture rules, legacy quick-play resume limitation, and feature boundaries are documented in `README.md`. The CRA build still reports its existing Browserslist-data age and Node deprecation notices; compilation and strict lint checks succeed.
