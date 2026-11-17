# Tournament backend

Backend-only individual Swiss tournaments. Existing frontend screens are unchanged.
Node.js 20+ is required. Quick play retains its legacy event protocol. Tournament
sessions use separate authenticated events and a durable move journal.

## Run

From the repository root:

```powershell
npm ci
npm run tournament:config
$env:TOURNAMENT_CONFIG_FILE = (Resolve-Path .\tournaments.local.json).Path
$env:SESSION_SECRET = "replace-with-a-long-random-persistent-secret"
npm start
```

The config generator refuses to overwrite an existing file. It produces three
10-minute rounds, a one-minute gap, registration closing in 20 minutes and round
one starting in 30 minutes. Edit the generated JSON before starting the backend.
Timestamps are UTC epoch milliseconds. All round starts are fixed at creation.
At least two active entrants must register before closing; otherwise the event
fails explicitly. The maximum feasible round count is n−1 for even n, n for odd n;
this necessary bound does not guarantee that all later pairing constraints remain
feasible after withdrawals/results.

The `key` identifies a provisioned tournament across server restarts. Reusing it
does not recreate or modify the tournament, even after its original dates pass.
Use a new key and future dates to provision a different tournament. There is no
public organizer/create/adjudication API in this phase.

Environment variables:

| Variable | Default |
| --- | --- |
| `PORT` | `8081` |
| `CLIENT_ORIGIN` | `http://localhost:3000` |
| `SESSION_SECRET` | Development-only local fallback; keep a configured secret stable across restarts |
| `TOURNAMENT_STATE_FILE` | `server/data/state.json` |
| `TOURNAMENT_CONFIG_FILE` | Optional JSON configuration array |

## Implemented rules

- Registration is session-owned, idempotent and closes at its fixed timestamp.
- Random initial seeding uses a saved random salt and deterministic hash ordering.
- Withdrawal is permanent. An unfinished published fixture is a withdrawal loss;
  finalized results never change. Future rounds exclude the withdrawn entrant.
- Requested byes are disabled. An odd field receives one full-point pairing bye,
  preferring the lowest standing eligible entrant. Previous full-point unplayed
  awards make an entrant ineligible for another full-point bye.
- Initial pairings split the seeded field into halves after removing a bye.
  Later pairings prefer score brackets and split halves; backtracking permits
  swaps and cross-bracket floats. Repeated opponents and a third consecutive
  played color are forbidden. This is a custom Swiss strategy, not certified
  FIDE Dutch pairing software, and does not promise globally optimal pairing cost.
- Search is bounded at 100,000 recursive nodes. `NO_VALID_PAIRING` and
  `SEARCH_LIMIT_REACHED` are distinct. Either explicitly fails the tournament
  without fabricating results or shifting its schedule.
- Players enter the socket waiting room before the scheduled start. A live
  assigned-player connection is required at the start: one absent loses, both
  absent receive a draw. There is no late-arrival grace period.
- All fixtures in a round start concurrently. Individual chess clocks are not
  implemented; the hard match deadline provides the requested time limit.
- Disconnecting the last game connection opens the reconnect window (default
  60 seconds, capped at the match deadline). Multiple tabs do not create false
  disconnects. A player whose own window expired cannot reconnect into that game.
- If both disconnect, the other player may return within their own window and
  win once the opponent's window has expired. If both windows expire, draw.
- Explicit resignation is immediate; accidental leave/disconnect uses grace.
- A still unfinished match at its deadline is a draw. At an equal timestamp,
  hard-deadline draw takes precedence over reconnect expiry and incoming moves.
- Finishing early prepares the next round but never starts it early.
- Standings use score, Buchholz, Sonneborn–Berger, then played wins. Remaining
  competitive ties share placing; seed is only a stable display order.

Tiebreak adjustment reference: [FIDE effective March 2026, articles 16.3–16.4](https://handbook.fide.com/chapter/TieBreakRegulations032026).
Opponent scores adjust terminal withdrawal rounds to draws. Unplayed own-round
contributions use a capped dummy score: forfeits are capped by the scheduled
opponent's adjusted score; other unplayed awards by half the tournament rounds.
The platform-specific double-no-show draw uses the latter category. A started
game is treated as played for this platform's ledger. Rules are versioned;
this platform's custom outcomes are not a claim of FIDE-rated compliance.

## Player HTTP API

All routes require the existing `/auth` session cookie. JSON error shape:
`{ "error": { "code": "...", "message": "..." } }`.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/tournaments` | List tournaments and fixed schedules |
| GET | `/tournaments/:id` | Tournament, rounds, pairings and results |
| GET | `/tournaments/:id/rounds` | Round list |
| GET | `/tournaments/:id/standings` | Rebuilt standings |
| GET | `/tournaments/:id/my-status` | Own entrant, fixtures, next start, server time |
| POST | `/tournaments/:id/registrations` | Register the authenticated player |
| DELETE | `/tournaments/:id/registrations/me` | Permanently withdraw |
| GET | `/tournaments/:id/matches/:matchId` | Assigned player's game state |

Registration ignores client-supplied player identities. There is no HTTP check-in:
presence requires a socket waiting-room/game connection.

## Tournament Socket.IO protocol

Connect using the HTTP session cookie (`withCredentials: true` for a browser).
Every command reloads persistent authentication. Logout destroys the session and
disconnects its sockets. Anonymous legacy quick-play sockets remain compatible.

All request events use acknowledgment callbacks:

```js
// response: { ok: true, data } or { ok: false, error: { code, message } }
socket.emit('game:join', { tournamentId, matchId }, callback);
socket.emit('game:sync', { tournamentId, matchId }, callback);
socket.emit('tournament:subscribe', { tournamentId }, callback);
socket.emit('game:leave', {}, callback); // disconnect presence, not resignation
socket.emit('game:command', {
  tournamentId,
  matchId,
  command: {
    type: 'MOVE',
    commandId: crypto.randomUUID(),
    expectedMoveSequence: 0,
    from: { row: 1, col: 4 },
    to: { row: 3, col: 4 }
  }
}, callback);
```

Coordinates follow the engine: row 0 is rank 1; col 0 is file a. Display orientation
must not alter server coordinates. Other command types are `RESIGN`, `OFFER_DRAW`,
and `ACCEPT_DRAW`, each with a unique command ID. An accepted duplicate returns
its original response; reusing an ID with different data is rejected. Moves
require the expected sequence and the assigned side's turn.

`tournament:event` delivers `{ eventId, tournamentId, type, version, ...payload }`.
It is an invalidation notification, not a board delta. Fetch standings or call
`game:sync` as appropriate. On reconnect, always fetch a full snapshot and rejoin.
Socket delivery is at least once to currently connected clients, not a durable
per-client inbox. Use event IDs/versions to tolerate duplicates.

The future countdown UI should use `nextRoundStartsAt` and `serverNow`. Client
timers are display-only; server time decides eligibility and outcomes.

## Storage, transactions and recovery

`MemoryStore` and `FileStore` implement `read(fn)`, synchronous
`transaction(fn)`, and `close()`. Transactions work on detached draft state;
failure publishes nothing. The durable adapter fsyncs a replacement checkpoint
then atomically renames it before acknowledging. A process lock prevents two
servers from writing the same file. Corrupt/unsupported files fail closed.

Tournament aggregates contain entrants, rounds, fixtures, game journals and
results. Byes are round awards. Accepted command receipts provide idempotency.
The checkpoint also stores HTTP sessions and an outbox. It contains private
session information and should be backed up/access-controlled accordingly.

The current unit of work serializes the entire checkpoint, intentionally for a
single backend process. It is not intended for a network filesystem, multiple
writers, or large deployment scale. A database adapter can first preserve the
same transactional document contract. Normalizing into tables later should
replace aggregate storage access with repository queries while preserving domain
rules and the atomic boundaries below; that is not a zero-effort schema migration.

Atomic boundaries:

- Registration capacity check plus entrant insertion.
- Round publication plus every match and award.
- Withdrawal plus affected match result.
- Accepted move journal plus command receipt and terminal result, if any.
- Result plus game closure and outbox event.

Deadlines are persisted as schedule fields and reconnect timestamps; no timer
handle is authoritative. The worker derives due actions, executes them in
effective-time order and retries safely. Each player command also reconciles
deadlines. Database adaptation must preserve these invariants, uniqueness, and
serializable mutations, along with the shared adapter tests.

On restart, overdue decisions are resolved before new commands. Active boards
are reconstructed from committed move journals. Previously connected players get
a fresh reconnect window if their game has not already expired. Existing elapsed
player-reconnect deadlines remain authoritative. Waiting-room sockets do not
survive restart: offline round starts resolve attendance as absent. Fixed match
deadlines and round starts never shift. Server downtime can therefore cause
deadline/no-show draws; it does not guarantee continuous availability.

The retained engine is versioned `legacy-king-capture-v1`. It does not implement
full standard chess legality, castling, promotion, en passant, checkmate or
stalemate. Tournament game completion follows its king-capture outcome, plus
resignation, agreed draws, forfeits and deadline decisions. Replacing the engine
requires a versioned journal migration or retaining the old engine for recovery.
Quick-play game recovery is not added in this phase; recovery covers tournament
games. No frontend tournament page, Elo, team implementation, organizer flow,
result correction API or database-specific adapter is included.

## Verification

```powershell
npm test
```

Tests use Node's built-in runner and temporary files/localhost servers. They cover
pairing invariants, score awards, strict timing, attendance, reconnects, moves,
game completion, duplicate commands, transactional rollback, disk restore,
offline catch-up, authentication, logout revocation, and legacy quick play.
They require no frontend install, external database, or internet connection.
