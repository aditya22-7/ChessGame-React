# Chess database schema

Schema implementation for **MySQL Community Server 8.4 LTS / InnoDB**.
The application is now connected through the [SQL backend](../server/sql/README.md),
using `mysql2/promise`. Existing files are retained and never imported automatically.

## Codebase status and commands

The schema package is finalized for the current individual-tournament scope.
SQL definitions are versioned, the standalone schema is generated from those
definitions. Live data cutover remains an explicit deployment step. Sequelize is not
used; the schema tools and backend use `mysql2/promise`.

From the repository root:

| Command | Purpose |
| --- | --- |
| `npm run db:install` | Install the isolated database tool dependencies from their lockfile |
| `npm run db:check` | Offline schema-generation, migration and configuration checks; no database connection |
| `npm run db:build` | Regenerate the standalone SQL from canonical migrations |
| `npm run db:test` | All discovered tests; live acceptance tests skip without opt-in |
| `npm run db:test:integration` | Explicit live acceptance run; refuses to start without test port/user configuration |
| `npm run db:migrate` | Apply/check versioned migrations on the explicitly selected database |
| `npm run db:verify` | Check the deployed journal and committed-state diagnostics |

`database/.env.example` documents variables without containing credentials.
Copying it does not load it automatically. Real `.env`/`.env.*` files are ignored
by Git; the reference example remains tracked.

## Contents

| Path | Purpose |
| --- | --- |
| `migrations/001_legacy_baseline.sql` | All 26 supplied `game_*` table definitions, dependency ordered, without dump data or destructive directives |
| `migrations/002_legacy_extensions.sql` | Compatible column extensions, checks and stronger team ownership relationships |
| `migrations/003_competition.sql` | Sessions, configuration, entrants, individual registration, rounds, allocations, slots and opponent pairs |
| `migrations/004_games_ratings_operations.sql` | Games, participants, move journal, receipts, results, Elo and operational queues |
| `migrations/005_integrity_guards.sql` | Publication, immutability, sequencing, context and settlement guards |
| `migrations/006_integrity_views.sql` | Read-only score/rating ledgers and committed-state diagnostics |
| `schema.sql` | Generated complete fresh-install script, including the migration journal/checksums |
| `legacy-manifest.json`, `legacy-shape.json` | Names and metadata of the supplied baseline; no player data |
| `tools/migrate.js` | Explicit database migration runner with advisory lock and checksum journal |
| `tools/verify.js` | Migration/check-constraint verification and committed-state diagnostics |
| `tests/` | Static checks and actual MySQL acceptance tests |
| `RELATIONSHIPS.md` | Table ownership, keys and database/application boundary |
| `TRANSACTIONS.md` | Required write order for future repository integration |

The unrelated `mydb`, `nodedb` and `registerdata` tables are not copied into `game`.
No source `INSERT` data, credentials, `DROP TABLE`, disabled FK checks or stored
application accounts are included. The only production seeds are Swiss format
metadata and the versioned current Elo policy.

## Fresh installation

Install MySQL 8.4 and create an **empty** database using a database administrator:

```sql
CREATE DATABASE game CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

Use a migration account with schema DDL/trigger/routine privileges. Do not expose
that account to the eventual application. From the repository root:

```powershell
npm ci --prefix database
$env:MYSQL_HOST = '127.0.0.1'
$env:MYSQL_PORT = '3306'
$env:MYSQL_DATABASE = 'game'
$env:MYSQL_USER = 'your_migration_account'
$env:MYSQL_PASSWORD = 'your_local_password'
npm --prefix database run migrate
npm --prefix database run verify
```

The runner does not create or select a database implicitly. `MYSQL_DATABASE` is
required and limited to a simple lowercase identifier. Passwords are read from
the environment and are never printed by the tooling. `.env` files are ignored
by Git but are **not automatically loaded**.

Alternative: select an EMPTY database in the MySQL command-line client and use
`SOURCE /absolute/path/to/database/schema.sql`. That script produces the same
journal as the runner and can subsequently be verified/migrated by the runner.
It is not an existing-database upgrade script. Do not run it with the client's
`--force` option, which would continue after an error.

## Existing supplied schema

Back up the database and rehearse on a restored copy first. For a database that
contains exactly the original 26 supplied tables:

```powershell
npm --prefix database run migrate -- --adopt-legacy
```

Adoption compares table names, columns, indexes and foreign keys against the
reviewed baseline. It also checks orphans and the legacy relationships that the
new constraints strengthen. Unsafe data is reported by category/count, without
printing passwords. Failed preflight leaves extension DDL unapplied. Correct data
only through a separately reviewed repair; the runner never guesses repairs.

Tables with schema drift or unrelated tables are refused. `--adopt-legacy` is
not a force flag and does not disable foreign keys. Legacy adoption is opt-in;
ordinary migration refuses an untracked nonempty schema.

Use `npm run db:migrate -- --help` for usage without connecting. Unknown flags
are rejected before connecting: in particular, `--dry-run` and `--force` are not
silently ignored. Offline review is provided by `db:check`, not a migration mode.

Once migrations are recorded, re-running checks the journal and applies only
new migrations. Applied SQL must not be edited. Checksums normalize CRLF/LF so
Windows Git line-ending conversion does not invalidate the journal.

**MySQL DDL commits implicitly.** A failed/interrupted migration may have applied
some statements. RUNNING/FAILED journal entries block retries; inspect the
recorded migration, back up, and restore or perform a reviewed recovery. There is
no destructive automatic rollback or blind `IF NOT EXISTS` repair.

## Existing-table changes

- All names, primary keys, data and original foreign keys are retained.
- `player._password` grows to 255 characters; username grows to 64. This does
  **not** hash existing passwords or migrate authentication. That belongs to the
  later account/backend migration.
- First/last names become nullable for current username-only accounts.
- Existing tournament name grows to the current backend's 120-character limit.
- Tournament start/end gain millisecond precision, lifecycle/version fields,
  registration bounds and a provisioning key.
- Counts and criteria gain nonnegative/range checks.
- Team registrations, rosters and boards gain complete composite parent keys
  and derived scope columns. Backfills derive only FK ownership, not outcomes.
- Old board `start_time VARCHAR(36)` is preserved verbatim. A new nullable
  `scheduled_start_at DATETIME(3)` is reserved for a reviewed timezone-aware
  backfill. No string timestamp is silently interpreted.
- Existing team result/move actors must belong to their actual fixture.
- Legacy `draw VARCHAR` values remain untouched. Their text vocabulary is not
  guessed; canonical outcomes in the new flow use `game_result` instead.

Because the newly required team scope columns are non-null, future writers of
the legacy team tables must supply those columns. The current backend does not
write these SQL tables. Team gameplay remains deferred.

## Current policy compatibility

The schema implements one individual competition type with a pluggable format
catalog, initially Swiss. Random seeding, the fixed schedule and reconnect policy
are frozen. Requested byes are disabled. Full-point byes have at most one per
round and cannot repeat for an entrant. Withdrawal is permanent.

The database does not generate Swiss pairings, implement chess legality, or
calculate Elo. Those tested functions remain in the backend. It stores engine
versions, ordered moves and enough provenance to restore/reconcile them.

One Elo pool starts at 1200 with K=32. The catalog stores version
`platform-elo-1`. Settlement guards exclude unrated reasons, guests and same-account
play; rated results require at least two accepted plies. Integer Elo has no floor,
matching the existing code. Rating changes and results are immutable.

Scores are exact decimal values. Shared final ranks are allowed. UUID IDs use
the supplied UTF-8 collation for FK compatibility; new command IDs, codes, policy
versions and hashes use case-sensitive ASCII columns.

## Verification and tests

```powershell
# Static tests; MySQL acceptance tests are explicitly skipped without opt-in.
npm --prefix database test

# LIVE tests: use a dedicated test MySQL instance/account with CREATE/DROP DATABASE.
$env:MYSQL_SCHEMA_TEST = '1'
$env:MYSQL_TEST_HOST = '127.0.0.1'
$env:MYSQL_TEST_PORT = '33379'
$env:MYSQL_TEST_USER = 'your_test_account'
$env:MYSQL_TEST_PASSWORD = 'your_test_password'
npm --prefix database test
```

Live tests create randomly named `chess_schema_test_<hex>` schemas and remove only
those schemas afterwards. They do not use `MYSQL_DATABASE` or touch a `game`
database. They exercise real MySQL 8.4, not SQLite or MariaDB compatibility mode.

For the explicit root command, set `MYSQL_TEST_PORT` and `MYSQL_TEST_USER` as well
as any needed test host/password, then run `npm run db:test:integration`. It sets
the opt-in flag itself, and configuration or connection failure is an error,
not a successful run with the live suite silently skipped.

Build/check the standalone file:

```powershell
npm --prefix database run build
node database/tools/build.js --check
```

Run `verify` against a quiet consistent committed database. Do not use an ongoing
multi-query verification run as an atomic snapshot while writers are active.
Views report incomplete committed operations, including a result without its
applied rating decision, incomplete Elo settlement, stale move sequences and
rating balances. Normal intermediate writes inside one transaction can appear
in the writing connection's diagnostics until that transaction is finished.

## Deployment boundary

The backend repositories and runtime driver are implemented in `server/sql/`.
Production credentials, startup migrations and live database deployment are not
included. Existing file tournaments/history need a separate reviewed import.
An explicit account-only import command is documented in the SQL backend guide.

One source-data condition needs an audit before backend cutover: old quick-play
rating records may contain outcomes and move counts without saved move journals.
If present, they require an explicit reviewed legacy-rating import/provenance
path; ordinary journal-backed game/rating constraints must not be bypassed and
missing moves must not be invented. No legacy game/rating-history importer is included.

The runtime uses asynchronous transactions, UTC connections, row locks,
server-authoritative deadlines, idempotent commands and the write contracts in
`TRANSACTIONS.md`. It plans one tournament aggregate and writes normalized rows,
rather than adapting the synchronous whole-file checkpoint to SQL.
