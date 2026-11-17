# Future backend transaction contracts

This schema does not replace service logic with stored tournament procedures.
The small stored procedures only share validation between triggers. All commands
below must be implemented as asynchronous repository transactions in the next
backend phase. Do not auto-commit each statement.

## Registration / withdrawal

Lock the tournament. Read its authoritative registration deadline/capacity and
current active count. Insert entrant and player registration together; the unique
tournament/player key handles duplicate requests. Seed IDs are entrant IDs, not
usernames. Preserve the row on withdrawal; do not delete and reinsert it.

Withdrawal locks affected fixtures in the global lock order, marks the entrant
withdrawn, resolves published unfinished fixtures, changes an upcoming pairing
bye to a pending zero-point withdrawn award if applicable, and appends events.
Never change completed results or award retroactive Elo for a forfeit.

## Configuration and schedule

Create the tournament DRAFT with registration and overall bounds. Create its
configuration unfrozen, then every round SCHEDULED. Freeze configuration only
after their count, duration and fixed gaps agree. Open registration afterwards.
Frozen configuration cannot be edited, even to unfreeze it. The versioned rules
and engine code must remain available for historical replay.

## Pairing publication

Compute Swiss proposals outside long DB transactions using a consistent input
snapshot and competition version. In a transaction:

1. Lock tournament and revalidate registration/results version.
2. Create round allocations (MATCH/byes/withdrawn awards).
3. Insert fixtures DRAFT, then both slots.
4. Insert the canonical opponent-pair records. Unique violations reject repeats.
5. Set fixtures WAITING. Their publication trigger checks both slots/pair.
6. Publish round PAIRED with algorithm version, input hash/version and timestamp.
7. Append outbox events; commit.

The service must check the full policy, including colors, eligible bye selection
and score brackets. Do not relax Swiss rules because an insert fails.

## Attendance / session startup

Create a WAITING session when appropriate, uniquely linked to the match, and both
assigned participants. Tournament participants reference their exact match slot,
entrant and player registration. Missing/unjoined rows mean absent, not a guest.
Quick-play participants may have a null player ID with a nonempty guest label.

At the fixed start, resolve live presence from authenticated connections in the
current boot epoch. Start the round IN_PROGRESS. If both are present, set match
IN_PROGRESS with its actual/effective start, then set session IN_PROGRESS with
the same start. A single absence forfeits; double absence draws. Existing live
connection counts do not survive restart merely because timestamps remain.

## Accepting a nonterminal move

Lock session, reconcile elapsed deadlines, and check accepted command receipts.
Reload the engine at its committed sequence, validate the assigned side and move.
Insert the next `game_move`; advance `current_move_sequence` by one and switch
`side_to_move`. Insert the accepted command receipt. Update a complete versioned
snapshot if used, clear/adjust draw offer as policy requires, append an outbox
event and commit. Acknowledge only afterwards.

The trigger does not advance the session on behalf of the service. Committing
only the journal insert leaves a detectable sequence mismatch. Command IDs and
request hashes are case-sensitive. A duplicate accepted request returns its
original response; different data under an existing ID is a conflict.

## Finalizing a game / match

Use a consistent lock order: tournament when needed, match, session, then both
rating accounts ordered by player ID. Nonterminal move handling need not hold the
tournament lock. If a terminal move is discovered while holding only session
locks, revalidate in the ordered finalization transaction rather than acquiring
parent locks in reverse order. Retry whole transactions after deadlocks.

Within one transaction:

1. Resolve applicable deadlines and check for an existing immutable result.
2. For a terminal move, insert/advance its journal as above.
3. Insert `game_result`. A hard-deadline draw uses the round's exact deadline;
   later recovery uses a later `recorded_at`, not a shifted effective time.
4. Insert `rating_settlement` PENDING. Its optional session ID exactly matches
   the result; unplayed no-show fixtures can have no game session.
5. If rated, create missing rating profiles at the policy opening balance, read
   both pre-result ratings under lock, calculate in the tested Elo function, then
   insert both `player_rating_change` rows with each next history version.
6. Update both profiles, counters and lock versions. For an unrated result, do
   not create rating changes or alter profiles.
7. Mark settlement APPLIED with finalization time. Its guard requires complete
   changes and updated profiles before it allows this transition.
8. Close any associated session FINALIZED with the result's effective time.
9. Finalize tournament fixture with that same time, if applicable.
10. Resolve both MATCH allocations at the result's effective time.
11. Insert the terminal command receipt where applicable, update competition
    version/cached statistics and append events. Commit; then acknowledge.

Any failure rolls back the result, changes, profiles and receipt together. Results
have unique match/session keys; settlements have a unique result key. No public
API may accept client-supplied ratings or award points directly.

## Byes, completion and standings

Activate bye/withdrawn awards at the round start and resolve those allocations.
MATCH points live only in results, never a second allocation score column.
Complete the round only after every fixture and allocation is resolved. Prepare
the next round without changing its fixed start. Persist final standings from
the complete versioned result ledger, then complete the tournament. Shared ranks
are permitted. Tiebreaks require the existing versioned unplayed-round policy.

## Recovery / queue delivery

Record jobs and outbox events with business state. Jobs are retryable and their
target's persisted deadline/generation remains authoritative. Reconcile elapsed
actions in effective-time order on startup and on player commands. Existing
results win over duplicates. Restart grace must distinguish server shutdown from
an already elapsed player disconnect, without moving hard match deadlines.

Claim short queue batches transactionally, using leases and indexed due times.
Publish notifications after commit with event ID/version, then mark delivered.
Clients resync after reconnect; the outbox is not a per-client durable inbox.

## Migration from the current file adapter

Map canonical usernames to existing/new `player_id` values through a reviewed
identity map. Preserve entity IDs, timestamps, move order, engine versions,
results, command receipts, policy versions and rating history. Replay stored
rating changes in settlement order without recalculating/awarding games again.
Account profiles initialize at the policy baseline and advance through their
existing immutable history. Detect inconsistencies instead of silently resetting.

Audit quick-play history separately: the old quick-play rating records do not
necessarily contain move journals. A move count is not a recoverable journal.
If these records exist in the source data, design a reviewed legacy-rating
import/provenance migration before cutover. Do not feed invented moves through
normal game tables or disable triggers to reconstruct unsupported history.

Source team string timestamps need an explicit timezone/format backfill. Password
column widening is not password hashing. Never infer games/results from summary
counters, and never force individual entrants into dummy team records.
