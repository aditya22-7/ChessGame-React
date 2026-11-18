/** FIDE 2026 articles 16.3/16.4 for BH/SB, with the platform's
 * double-absence draw mapped to a voluntary unplayed half-point award.
 * Terminal withdrawal rounds are zero-point requested byes.
 */
function ledger(tournament) {
  const records = Object.fromEntries(tournament.entrants.map(e => [e.id, []]));
  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      if (!match.result) continue;
      for (const side of ['white', 'black']) {
        const other = side === 'white' ? 'black' : 'white';
        records[match[side + 'EntrantId']].push({ round: round.number,
          opponent: match[other + 'EntrantId'], points: match.result[side + 'Points'],
          played: match.startedAt !== null, type: match.result.reason });
      }
    }
    for (const award of round.startedAt !== null ? round.awards : []) records[award.entrantId].push({ round: round.number,
      points: award.points, played: false, type: award.type, opponent: null });
  }
  return records;
}
function standings(tournament) {
  const records = ledger(tournament);
  const scores = Object.fromEntries(Object.entries(records).map(([id, rounds]) =>
    [id, rounds.reduce((sum, r) => sum + r.points, 0)]));
  const adjusted = Object.fromEntries(Object.entries(records).map(([id, rounds]) =>
    [id, rounds.reduce((sum, r) => sum + (r.type === 'WITHDRAWN_BYE' ? 0.5 : r.points), 0)]));
  const rows = tournament.entrants.map(entrant => {
    let buchholz = 0, sonnebornBerger = 0, playedWins = 0;
    for (const r of records[entrant.id]) {
      let opposition;
      if (r.played) opposition = adjusted[r.opponent];
      else if (r.opponent && r.type !== 'DOUBLE_NO_SHOW') {
        opposition = Math.min(scores[entrant.id], adjusted[r.opponent]);
      } else opposition = Math.min(scores[entrant.id], tournament.totalRounds * 0.5);
      buchholz += opposition;
      sonnebornBerger += opposition * r.points;
      if (r.played && r.points === 1) playedWins++;
    }
    return { entrantId: entrant.id, playerId: entrant.playerId, status: entrant.status,
      seed: entrant.seed, score: scores[entrant.id], buchholz, sonnebornBerger, playedWins };
  });
  const competitive = (a, b) => b.score - a.score || b.buchholz - a.buchholz ||
    b.sonnebornBerger - a.sonnebornBerger || b.playedWins - a.playedWins;
  rows.sort((a, b) => competitive(a, b) || (a.seed ?? Infinity) - (b.seed ?? Infinity) || a.entrantId.localeCompare(b.entrantId));
  rows.forEach((r, i) => { r.rank = i && competitive(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}
function pairingPlayers(tournament) {
  const rows = standings(tournament);
  return rows.filter(e => e.status === 'REGISTERED').map((e, rankIndex) => {
    const opponents = [], colors = [];
    let fullPointUnplayed = false;
    for (const round of tournament.rounds) {
      for (const match of round.matches) {
        const side = match.whiteEntrantId === e.entrantId ? 'white' : match.blackEntrantId === e.entrantId ? 'black' : null;
        if (!side) continue;
        opponents.push(match[side === 'white' ? 'blackEntrantId' : 'whiteEntrantId']);
        if (match.startedAt !== null) colors.push(side);
        if (match.result && match.startedAt === null && match.result[side + 'Points'] === 1) fullPointUnplayed = true;
      }
      if (round.awards.some(a => a.entrantId === e.entrantId && a.points === 1)) fullPointUnplayed = true;
    }
    return { id: e.entrantId, seed: e.seed, rankIndex, score: e.score, opponents, colors, fullPointUnplayed };
  });
}
module.exports = { standings, ledger, pairingPlayers };
