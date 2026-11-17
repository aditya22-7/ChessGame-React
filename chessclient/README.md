# Chess Olympics frontend

The React client retains the existing navy/ivory/gold/green theme and serif headings. The new authenticated shell provides a dashboard, tournament directory, registration/withdrawal, schedules/pairings, standings, player assignments, tournament waiting rooms/games, rating history, and quick play.

## Run locally

Start the configured backend following `../server/sql/README.md`, then in this directory run `npm ci` and `npm start`. Open `http://localhost:3000`. Login uses provisioned backend accounts; public signup/password reset are not implemented. For two players, use separate browser profiles or a normal and incognito window.

`REACT_APP_API_URL` defaults to `http://localhost:8081`. Set it before starting/building if the backend is elsewhere, and set the backend's `CLIENT_ORIGIN` to the frontend's actual origin. CRA loads the client's local environment files; the backend requires its own environment configuration. No database credentials belong in frontend configuration.

After login the main route is `/home`. Tournament routes are `/tournaments`, `/tournaments/:id`, `/rounds`, `/standings`, `/my-status`, and `/matches/:matchId` under each tournament. Quick play uses `/play`; `/profile/rating` shows up to 100 recent rated games. Existing `/newgame` and `/game` routes remain compatible with the legacy screens.

## State and transport boundaries

- TanStack Query caches HTTP data. Registration/withdrawal mutations never optimistically award attendance, results, points or ratings. Socket events invalidate the appropriate queries. Polling and focus/reconnect refreshes cover missed events.
- `app/RuntimeProvider.js` owns the authenticated tournament socket, active participation, synchronization, and command recovery. Attendance survives navigation across authenticated pages. Only an acknowledged socket join establishes confirmed attendance.
- Match commands use one immutable command ID/payload until resolved. Unknown outcomes retain the pending command in account-scoped session storage. **Resolve action** retries the same command safely. Older receipts cannot overwrite newer revisions/move sequences. Disconnected clients do not queue new moves.
- Refresh reconnects the saved tournament participation using the server's current game state and join rules. Deadlines and expired reconnect windows remain authoritative on the backend. Logout clears private cached data and closes the connection.
- Countdown displays are derived from absolute server timestamps and monotonic elapsed time. Reaching zero locally does not create a result; actions stop while server confirmation is fetched.
- `features/game/ChessBoard.js` is shared by tournament and quick play. It supports touch/click selection, arrow-key navigation, Enter/Space activation, Escape to clear selection, and board flipping. It maps presentation squares to the existing engine coordinates. The server validates legality; no incompatible standard-chess move generator is installed.
- Quick play adapts the existing event protocol with dedicated response handling and the shared board. Leaving its screen closes the quick-play connection and may forfeit the match. Quick games cannot resume after refresh/disconnection under the current backend protocol. Tournament draw/resign/recovery features are exposed only in tournament mode.
- `app/theme.js`, `shared/Stack.js`, and the existing `PageBackground` centralize the visual theme and layouts. Legacy board CSS is scoped to its board, so data tables do not inherit chess-square styling.

Frontend presentation additions to the backend: `GET /session`, `tournament:unsubscribe`, public entrant display names, and game snapshots containing revision, player labels, and the accepted move journal. These require no schema migration. Server-side identity, scoring, deadlines and Elo remain unchanged.

## Verification

```powershell
$env:CI = 'true'
npm test -- --watchAll=false --runInBand
npm run build
```

Browser tests exercise the production build with the real SQL backend and two isolated browser sessions. Use a disposable MySQL 8.4 instance and stop other processes on ports 3000/8081:

```powershell
$env:MYSQL_DATABASE = 'chess_ui_test'
$env:MYSQL_HOST = '127.0.0.1'
$env:MYSQL_PORT = '33379' # your isolated test server port
$env:MYSQL_USER = 'your_test_admin'
$env:MYSQL_PASSWORD = 'your_test_password'
npm run build
npm run test:e2e
```

The suite refuses any database name except `chess_ui_test`. It creates/migrates that schema, adds uniquely named fixtures, and starts its own backend/static frontend; it does not delete existing fixtures. Use only a dedicated test instance. Headless Edge is used when installed at the standard Windows location. Otherwise run `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to your browser executable. Screenshots/traces are saved under the ignored `test-results/` directory.

The current implementation remains JavaScript to fit the existing stack. Team tournaments, organizer controls, spectator boards, public signup, standard FIDE chess rules, legal-destination highlighting, and general historical replay remain outside this release.
