const checks = [
  ['negative player counts', 'SELECT COUNT(*) n FROM player_history WHERE matches_played < 0 OR tournaments_played < 0'],
  ['invalid tournament counts/dates', 'SELECT COUNT(*) n FROM tournament WHERE number_of_teams < 0 OR number_of_players < 0 OR tour_start_day >= tour_end_day'],
  ['unsupported zero tournament dates', "SELECT COUNT(*) n FROM tournament WHERE CAST(tour_start_day AS CHAR) LIKE '0000-%' OR CAST(tour_end_day AS CHAR) LIKE '0000-%'"],
  ['invalid team counts', 'SELECT COUNT(*) n FROM teams WHERE number_of_players < 0'],
  ['negative team history', 'SELECT COUNT(*) n FROM team_history WHERE number_of_tournaments < 0'],
  ['invalid team criteria', 'SELECT COUNT(*) n FROM team_criteria WHERE minimum_ranking < 0 OR maximum_ranking < minimum_ranking OR minimum_players_number < 0 OR maximum_players_number < 0 OR maximum_players_number < minimum_players_number'],
  ['invalid tournament criteria', 'SELECT COUNT(*) n FROM tour_criteria WHERE MinimumRanking < 0 OR MaximumRanking < 0 OR MaximumRanking < MinimumRanking'],
  ['cross-tournament/self team fixtures', 'SELECT COUNT(*) n FROM tourteam_matches m JOIN tourteams a ON a.TourTeams_id=m.tourteam1 JOIN tourteams b ON b.TourTeams_id=m.tourteam2 WHERE a.tourID<>m.tourID OR b.tourID<>m.tourID OR m.tourteam1=m.tourteam2 OR m.start_time>=m.end_time'],
  ['wrong board roster', 'SELECT COUNT(*) n FROM tourteam_player_matches p JOIN tourteam_matches m ON m.TourTeamMatches_id=p.tourteam_matchID JOIN tourteamstate a ON a.TourTeamState_id=p.player1 JOIN tourteamstate b ON b.TourTeamState_id=p.player2 WHERE a.tourteamID<>m.tourteam1 OR b.tourteamID<>m.tourteam2 OR p.player1=p.player2 OR p.time_period<=0'],
  ['wrong tournament winner', 'SELECT COUNT(*) n FROM tournament_details d JOIN tourteams t ON t.TourTeams_id=d.winner_team WHERE t.tourID<>d.tourID'],
  ['wrong team result participants', 'SELECT COUNT(*) n FROM tourteam_match_details d JOIN tourteam_matches m ON m.TourTeamMatches_id=d.tourteam_matchID WHERE (d.winner_team IS NOT NULL AND d.winner_team NOT IN (m.tourteam1,m.tourteam2)) OR (d.losing_team IS NOT NULL AND d.losing_team NOT IN (m.tourteam1,m.tourteam2)) OR d.winner_team=d.losing_team'],
  ['wrong board result participants', 'SELECT COUNT(*) n FROM tourteam_player_match_details d JOIN tourteam_player_matches p ON p.tourteam_player_matches_id=d.tourteam_player_matchID WHERE d.white_pieces_player NOT IN (p.player1,p.player2) OR d.black_pieces_player NOT IN (p.player1,p.player2) OR d.white_pieces_player=d.black_pieces_player OR (d.winning_player IS NOT NULL AND d.winning_player NOT IN (p.player1,p.player2)) OR (d.losing_player IS NOT NULL AND d.losing_player NOT IN (p.player1,p.player2)) OR d.winning_player=d.losing_player OR d.playing_start_time>d.playing_end_time'],
  ['wrong legacy move actor', 'SELECT COUNT(*) n FROM tournament_match_moves v JOIN tourteam_player_matches p ON p.tourteam_player_matches_id=v.ttPlayerMatchesID WHERE v.tourTeamStateID NOT IN (p.player1,p.player2)'],
];
async function preflight(connection) {
  const failures = [];
  // All legacy declared foreign keys are checked even if an earlier dump import
  // disabled foreign_key_checks. Report counts only, never credential values.
  const [foreignKeys] = await connection.query(`SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);
  for (const fk of foreignKeys) {
    const ident = v => '`' + v.replaceAll('`', '``') + '`';
    const [[row]] = await connection.query(`SELECT COUNT(*) n FROM ${ident(fk.TABLE_NAME)} c LEFT JOIN ${ident(fk.REFERENCED_TABLE_NAME)} p ON c.${ident(fk.COLUMN_NAME)}=p.${ident(fk.REFERENCED_COLUMN_NAME)} WHERE c.${ident(fk.COLUMN_NAME)} IS NOT NULL AND p.${ident(fk.REFERENCED_COLUMN_NAME)} IS NULL`);
    if (Number(row.n)) failures.push(`${fk.TABLE_NAME}.${fk.COLUMN_NAME}: ${row.n} orphan references`);
  }
  for (const [label, sql] of checks) {
    const [[row]] = await connection.query(sql);
    if (Number(row.n)) failures.push(`${label}: ${row.n} rows`);
  }
  if (failures.length) throw new Error('Legacy preflight failed; no extension DDL was applied:\n' + failures.join('\n'));
}
module.exports = { preflight };
