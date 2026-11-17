# Platform Elo

One persistent rating pool is shared by tournament and authenticated quick-play
games. It is a platform rating, not an official FIDE rating. Swiss initial seeding
remains random, and tournament points/tiebreaks are independent of Elo.

## Version 1 policy

- Every new account starts at **1200**. An account with no rated games returns
  that default without creating artificial game history.
- Fixed **K = 32**, logistic scale **400**.
- Expected white score: `1 / (1 + 10 ** ((blackRating - whiteRating) / 400))`.
- White's raw change: `32 * (actualWhiteScore - expectedWhiteScore)`.
- Win/draw/loss scores are `1 / 0.5 / 0`. Both pre-result ratings are captured
  together. Round the white change symmetrically to an integer and use its
  negative for Black; each game conserves the sum of both ratings.
- There is no rating floor or rating-difference cap. Integer ratings can become
  negative. This avoids introducing an undocumented source of rating inflation.
- Policy constants live in `elo.js`, tagged `platform-elo-1` in every decision.
  Future formula changes should use a new version; existing history is immutable.

The general expectation/update equations are described in this
[research paper's institutional details](https://crest.science/wp-content/uploads/2022/02/2022-04.pdf).
The initial rating, fixed K, rounding, and eligibility below are platform choices.

## Eligibility

Both participants must be different authenticated accounts and **each must have
made at least one accepted move**. Because moves strictly alternate, this is
checked by requiring at least two accepted plies.

| Ending | Elo |
| --- | --- |
| Engine-reported completed game | Rated |
| Tournament resignation after both sides played | Rated |
| Tournament agreed draw after both sides played | Rated |
| Tournament hard-deadline draw after both sides played | Rated |
| Bye / no-show / withdrawal / disconnect forfeit | Unrated |
| Neither player returns after disconnect | Unrated |
| Immediate resignation/draw before both sides played | Unrated |
| Guest quick play or same-account play | Unrated |
| Leaving an unfinished legacy quick-play game | Unrated |

The current chess engine is still the existing king-capture ruleset. Legacy quick
play exposes engine completion, not new resignation/draw commands. Tournament
game commands retain their existing resignation/draw support.

Quick-play identity comes from the server session, not the supplied display name.
Anonymous quick play remains available, with `rated: false` in its initial game
data. The browser socket now includes credentials. Case variants of file-based
login names are resolved to the same account, including previously stored login
sessions, to prevent separate ratings for a single account on Windows.

## Persistence and atomicity

The existing transaction port stores two additional maps:

```text
ratings[playerId]
    rating, ratedGames, wins, draws, losses, updatedAt

ratingResults[gameId]
    players, outcome, reason, completedAt, moveCount
    policyVersion, rated, excludedReason
    white/black: before, after, delta, expected
    tournamentId, matchId, duplicate-detection fingerprint
```

Tournament settlement runs inside the same transaction as the result, game
closure, command receipt, and outbox event. A failed checkpoint cannot save just
one player's update or accept a result without its rating decision. Quick play
persists the completed outcome/rating decision before publishing its terminal
board; its candidate engine state is discarded if persistence fails.

Namespaced match/game IDs make settlement idempotent. Matching retries return
the original decision. A conflicting outcome for the same game is rejected.
Unrated completed decisions are recorded too and cannot be upgraded by a retry.
Concurrent completions are serialized by the existing single-writer transaction
port and use the ratings at their settlement position.

Existing pre-Elo checkpoints receive empty rating maps at startup. Historical
completed games are **not retroactively rated**. Active games can be rated when
they finish after the upgrade. Corrupt stored profiles fail validation rather
than being silently reset. Ratings and history survive restart through the
existing file adapter; its single-process limitations remain unchanged.

## HTTP API

All endpoints require the existing login cookie. There are no public write or
result-submission endpoints for ratings.

```text
GET /players/me/rating
GET /players/:playerId/rating
GET /players/me/rating-history?limit=20&offset=0
GET /players/:playerId/rating-history?limit=20&offset=0
```

Profiles return account identity, current rating, rated-game counts, wins, draws,
losses, update time, and the current policy. Unknown accounts return 404. History
contains only rated games, newest settlement first, with opponent, outcome score,
rating before/after/delta, source fixture, and timestamp. `limit` must be 1–100;
`offset` must be nonnegative. Tournament result payloads also include their rating
decision. Clients cannot supply starting ratings or declare a rated result.

The home screen displays current Elo, total rated games, and the latest five
rated results. It refreshes when mounted or the window regains focus. Failures
show an unavailable state rather than a sample rating. Game player cards fetch
the same profile API and refresh after game completion.

## Verification

`npm test` from the repository root covers calculations, zero-sum updates,
eligibility, duplicate/conflicting results, disk rollback, restart recovery,
authenticated APIs and a complete quick-play win using real session identities.

The focused home-screen tests can be run from `chessclient`:

```text
npm test -- --watchAll=false --runInBand --runTestsByPath src/features/lobby/NewGame.test.js
```
