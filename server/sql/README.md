# SQL backend

The executable backend uses `mysql2/promise` and MySQL 8.4 LTS. It never falls back to JSON when SQL fails, never applies migrations on startup, and never imports existing checkpoints automatically. `createServer()` remains the explicit file-backed factory for compatibility; use `createSqlServer()` for SQL.

## Setup (PowerShell)

1. Install dependencies: `npm ci` and `npm run db:install`.
2. Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` to your reviewed database. See `database/README.md` for creation, backup, legacy adoption, and privileges.
3. Run `npm run db:migrate`, then `npm run db:verify` using the migration account. This is a separate deployment step.
4. Set `SESSION_SECRET` to a stable random value of at least 32 characters. Rotate it only when prepared to invalidate existing logins. Set `CLIENT_ORIGIN`, and use HTTPS in production. `NODE_ENV=production` sets secure cookies; `TRUST_PROXY=1` trusts one reverse proxy if required by your deployment.
5. With the backend stopped, provision users explicitly: set `CHESS_ACCOUNT_PASSWORD`, run `npm run account -- create username`, then remove that password environment variable. Alternatively `npm run account -- import-users` imports existing `server/users/*.json` accounts as one transaction, hashes passwords with scrypt, and refuses any username conflict. It retains the source files. Database passwords stored as plaintext are deliberately not accepted by login.
6. Use `TOURNAMENT_CONFIG_FILE` for the existing keyed JSON tournament definitions. Keys make provisioning repeatable. Start using `npm start`. `/health/ready` returns SQL readiness. `BACKEND_STORAGE=file` explicitly selects the old backend for local legacy workflows.

Use a dedicated runtime account with SELECT/INSERT/UPDATE on application tables, SELECT on the migration journal/views, and EXECUTE on assertion routines needed by triggers. Runtime DDL is unnecessary. Keep migration credentials separate. Configure durable MySQL storage and backups; this code cannot guarantee durability beyond the database's own settings.

## Transaction boundaries

- UUID player IDs own sessions, registrations, game seats, results, and Elo history. Usernames remain login/display identifiers. Client-provided player names cannot impersonate another account.
- SQL sessions persist expiry and revocation. Each tournament socket action reloads the session. Logout commits revocation before disconnecting sockets.
- Tournament commands load one normalized aggregate under its tournament row lock. The tested synchronous Swiss state machine computes a disposable plan. The writer applies changes in FK/trigger order in the same transaction, then publishes socket presence and acknowledgements after commit. No serialized database checkpoint is stored.
- Rounds publish allocations, slots, and unique opponent pairs before becoming visible. Fixed schedules never shift. Bye points resolve at round start. Permanent withdrawal, no-shows, deadline draws, reconnect losses/double absence draws use the existing domain policy.
- All tournament commands, including moves, are serialized by the current single-instance coordinator. Games remain concurrently playable, but database command processing is serialized; per-game parallel writers are a future scalability change. Quick-play journals lock their game row and support command receipts.
- Accepted moves, journal sequence/turn, immutable command receipts, result, both Elo profiles/history, settlement, round progression, final standings, and tournament events commit atomically. Expired work commits separately before validating a late command. Retrying a command ID returns its stored response; reusing it with different content is rejected.
- Elo profile locks are acquired in UUID order. Deadlocks/lock timeouts are retried only before commit. An uncertain commit returns `COMMIT_OUTCOME_UNKNOWN`; resync and retry the same command ID. Never infer a failed commit from a lost acknowledgement.
- `scheduled_action` stores the next actionable deadline for each tournament. A non-overlapping worker reconciles every overdue domain transition, including multiple missed rounds, under the tournament lock. Obsolete actions are cancelled transactionally and replaced; SQL state, not process timers, owns deadlines.
- Outbox delivery happens after commit and is at least once. Clients deduplicate by event ID/version and resync; Socket.IO emission is not a guarantee of client receipt. Delivery errors retain events for retry.
- A dedicated MySQL advisory lock enforces one backend process for this database. Startup and migrations also coordinate through the schema lock; migrations refuse to run while a backend owns the database. Losing the runtime connection fails readiness and rejects transactions. Restart the backend after fixing connectivity; it does not attempt unsafe ownership reacquisition. Horizontal scaling requires a different ownership/presence design.
- Startup verifies the exact applied migration checksums, reconstructs boards from journals, reconciles missed deadlines, and applies bounded restart grace to active tournament participants. Grace never exceeds the original hard match deadline. Legacy quick-play has no reconnect identity; abandoned quick games receive an explicit unrated double-disconnect draw rather than disappearing.

## Existing data and scope

The supplied tables and relationships remain intact. Existing populated SQL schemas require the documented adoption preflight. File tournaments, sessions, Elo history and unfinished quick games are not silently converted. Before an actual cutover, inventory those files, back them up, and separately plan a checked import if history must be retained. In particular old quick-play rating records lack complete move journals and must not be fabricated into rated SQL games.

Existing game legality remains the project's `legacy-king-capture-v1` engine, not standard FIDE checkmate chess. Team tournaments, requested byes, organizer corrections and horizontal scaling remain outside the agreed implementation scope.

## Verification

`npm test` runs the original domain/file/HTTP/socket regressions and transaction failure tests. `npm run db:check` and `npm run db:test` validate schema artifacts/tooling. For a disposable fully migrated test database named `chess_*test*` or `chess_*integration*`, set explicit `MYSQL_DATABASE`, `MYSQL_PORT`, `MYSQL_USER` and any other needed connection variables, then run `npm run test:sql`. The runner opts into live tests only with that configuration. The suite adds uniquely named test accounts/tournaments; never point it at production. Run `npm run db:verify` afterwards to audit committed invariants.
