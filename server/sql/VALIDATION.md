# Backend / MySQL integration validation

Validated on 2026-11-17 using an isolated MySQL Community Server 8.4.13 / InnoDB instance bound to localhost port 33379. No production connection settings or existing user databases were used. The portable test server and its data are removed after validation.

## Results

- `npm test`: 53 passed. Includes existing domain, file persistence, engine, Elo, authentication and Socket.IO regressions, plus transaction deadlock/uncertain-commit/ownership failure checks.
- `npm run test:sql`: 24 passed against the migrated `chess_integration` test schema. The count includes the parent test and 23 flow checks.
- `npm run db:check`: 9 passed. Migration order/checksums, SQL parsing, generated schema and CLI safeguards remain consistent.
- `npm run db:test:integration`: 32 passed. Full schema installation, storage constraints and legacy-adoption acceptance suite on randomly named disposable schemas.
- `npm run db:verify`: 49 tables, 92 foreign keys, 66 triggers, six applied migrations, **zero committed integrity issues**.
- `node database/tools/build.js --check` and `git diff --check`: passed.

## SQL flows exercised

- Account creation with scrypt hashes; login, UUID-owned HTTP registration and rating APIs; persistent sessions across a server restart; logout revocation.
- Actual Socket.IO clients: anonymous access denied, session-owned tournament seats, turn validation, accepted moves, logout disconnection, and the legacy quick-play event protocol.
- Registration, permanent withdrawal, post-pairing forfeits, single/double no-shows, disabled re-entry, and insufficient-field failure.
- Random seeding, multiple Swiss rounds, odd fields, bye withdrawal, no-repeat opponent pairs, stored standings, and fixed-schedule catch-up across multiple missed rounds.
- Hard-deadline draws, commands arriving after a deadline, deadlines crossed while obtaining the parent lock, and snapshot reads that cannot expose uncommitted results.
- Multi-socket attendance, reconnect before expiry, reconnect forfeits, double disconnections, draw agreement, resignation, and restart grace bounded by the original hard deadline.
- Quick-play journal persistence, stale-move rejection, leave results, terminal king capture, final-board replay, Elo eligibility and command deduplication.
- Concurrent duplicate requests, exactly one result, both-player Elo settlement/history, and rollback after an injected failure **after** SQL Elo updates.
- Durable outbox retry, refusal of a second backend owner, refusal of migrations while the backend owns the database, committed-state integrity audit, and deliberately killed runtime-lock connection returning `DATABASE_UNAVAILABLE` without a file fallback.

The suite does not certify production credentials/deployment, horizontal scaling, real browser rendering, standard FIDE chess legality, team tournaments, or import of legacy game/rating checkpoints. The current engine remains the project's king-capture ruleset; SQL quick-play recovery records abandoned sessions as unrated draws because the legacy client has no resume identity. See `README.md` for deployment requirements and limitations.
