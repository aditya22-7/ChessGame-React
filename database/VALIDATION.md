# Validation record

Validated on 2026-11-17 using an isolated **MySQL Community Server 8.4.13**
portable instance bound to loopback. No Windows service was installed and no
existing application database was modified.

Schema acceptance run: **26 tests passed, 0 failed, 0 skipped**.

Subsequent codebase finalization added root commands, a credential template and
tooling checks without changing SQL definitions or migration checksums. The final
offline check passes **9 tests with no skips**. These cover migration ordering,
CLI option safety, target validation, connection cleanup and explicit live-test
opt-in, in addition to SQL generation checks. The historical live MySQL run above
is retained as schema evidence; a new live run was not performed during packaging
finalization because no test database credentials/server were configured.

The fresh schema contains 49 base tables: the 26 supplied chess tables,
22 new domain/operational tables, and the migration journal. It also contains
66 integrity triggers, five shared assertion procedures and three diagnostic/
ledger views. Both migration-runner installation and the generated standalone
script were executed successfully against actual MySQL.

The acceptance run covered:

- Fresh installation, checksum verification and repeat migration execution.
- Actual foreign-key/check enforcement and all original table names retained.
- Valid individual fixtures, ordered moves, result finalization, both Elo updates,
  history views, and shared final ranking storage.
- No-show results without a game session and unrated settlement.
- Cross-tournament ownership rejection, duplicate registrations and allocations.
- Fixed schedule/configuration and frozen rule/strategy immutability.
- Permanent withdrawal and immutable participant assignments.
- Move side/sequence validation, append-only history and accepted command receipts.
- Score/outcome mismatches, wrong session context and incorrect deadline times.
- Incomplete Elo settlement, manual rating changes, guest and same-account rating.
- One full-point bye per round, no repeated pairing bye, disabled requested byes.
- Repeat opponents and late fixture creation after round publication.
- Real transaction rollback and two-connection duplicate-registration contention.
- Scheduler target ownership and lease-shape checks.
- Adoption of populated legacy player, team, roster, board, result and move records
  without rewriting their original values.
- Unsafe legacy data and missing foreign keys rejected before extension DDL.
- Historical team/roster identity rewrites rejected after adoption.
- SQL delimiter parsing and generated schema consistency.

This validates the schema and its storage contracts. The SQL backend now has
separate validation in `../server/sql/VALIDATION.md`. This schema suite does not certify
production deployment, high availability, chess
legality, or Swiss/Elo algorithm implementations inside the database. Those
algorithms remain backend responsibilities. See `TRANSACTIONS.md` for integration
requirements and the committed-state limits of row-level constraints.
