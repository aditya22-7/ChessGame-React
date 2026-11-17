-- Operational diagnostics. Pending intermediate writes are legal WITHIN a
-- transaction; these views must be checked after committed business commands.
CREATE VIEW v_schema_integrity_issues AS
SELECT 'RESULT_NOT_SETTLED' AS issue_code,r.result_id AS entity_id FROM game_result r LEFT JOIN rating_settlement s ON s.result_id=r.result_id WHERE s.settlement_id IS NULL OR s.status<>'APPLIED'
UNION ALL
SELECT 'RATING_SETTLEMENT_INCOMPLETE',s.settlement_id FROM rating_settlement s LEFT JOIN player_rating_change c ON c.settlement_id=s.settlement_id WHERE s.status='APPLIED' GROUP BY s.settlement_id,s.rated HAVING (s.rated=1 AND (COUNT(c.player_id)<>2 OR COALESCE(SUM(c.rating_delta),1)<>0)) OR (s.rated=0 AND COUNT(c.player_id)<>0)
UNION ALL
SELECT 'GAME_SEQUENCE_MISMATCH',g.game_session_id FROM game_session g LEFT JOIN game_move m ON m.game_session_id=g.game_session_id GROUP BY g.game_session_id,g.current_move_sequence HAVING COUNT(m.move_id)<>g.current_move_sequence OR COALESCE(MAX(m.move_sequence),0)<>g.current_move_sequence
UNION ALL
SELECT 'PLAYING_GAME_PARTICIPANTS',g.game_session_id FROM game_session g LEFT JOIN game_participant p ON p.game_session_id=g.game_session_id WHERE g.status='IN_PROGRESS' GROUP BY g.game_session_id HAVING COUNT(p.participant_id)<>2
UNION ALL
SELECT 'UNFINISHED_GAME_WITH_RESULT',g.game_session_id FROM game_session g JOIN game_result r ON r.game_session_id=g.game_session_id OR r.tournament_match_id=g.tournament_match_id WHERE g.status<>'FINALIZED'
UNION ALL
SELECT 'UNFINISHED_FIXTURE_WITH_RESULT',m.match_id FROM tournament_match m JOIN game_result r ON r.tournament_match_id=m.match_id WHERE m.status<>'FINALIZED'
UNION ALL
SELECT 'RATING_BALANCE_MISMATCH',p.player_id FROM player_rating p LEFT JOIN player_rating_change c ON c.player_id=p.player_id GROUP BY p.player_id,p.initial_rating,p.rating,p.rated_games,p.lock_version HAVING p.rating<>p.initial_rating+COALESCE(SUM(c.rating_delta),0) OR p.rated_games<>COUNT(c.player_id) OR p.lock_version<>COALESCE(MAX(c.player_rating_version),0)
UNION ALL
SELECT 'PUBLISHED_FIXTURE_SLOTS',m.match_id FROM tournament_match m LEFT JOIN tournament_match_slot s ON s.match_id=m.match_id WHERE m.status<>'DRAFT' GROUP BY m.match_id HAVING COUNT(s.slot_id)<>2
UNION ALL
SELECT 'PUBLISHED_FIXTURE_PAIR',m.match_id FROM tournament_match m LEFT JOIN tournament_opponent_pair p ON p.match_id=m.match_id WHERE m.status<>'DRAFT' AND p.match_id IS NULL
UNION ALL
SELECT 'SEEDED_ENTRANT_WITHOUT_PLAYER',e.entrant_id FROM tournament_entrant e LEFT JOIN tournament_player_registration p ON p.entrant_id=e.entrant_id WHERE e.seed_number IS NOT NULL AND p.entrant_id IS NULL;

CREATE VIEW v_player_rating_history AS
SELECT c.player_id,s.settlement_sequence,r.result_id,r.tournament_match_id,r.game_session_id,
       c.color,c.rating_before,c.rating_after,c.rating_delta,c.expected_score,c.player_rating_version,
       s.policy_version,r.outcome,r.reason,r.effective_at,r.recorded_at
FROM player_rating_change c JOIN rating_settlement s ON s.settlement_id=c.settlement_id AND s.status='APPLIED'
JOIN game_result r ON r.result_id=s.result_id;

CREATE VIEW v_tournament_score_ledger AS
SELECT a.tournament_id,a.round_id,a.entrant_id,a.allocation_id,
       CASE WHEN s.color='WHITE' THEN r.white_points ELSE r.black_points END AS points,
       r.reason AS reason,r.effective_at AS effective_at,
       CASE WHEN m.actual_started_at IS NOT NULL THEN 1 ELSE 0 END AS played,
       opponent.entrant_id AS opponent_entrant_id
FROM tournament_round_allocation a JOIN tournament_match_slot s ON s.allocation_id=a.allocation_id
JOIN tournament_match m ON m.match_id=s.match_id JOIN game_result r ON r.tournament_match_id=m.match_id
JOIN tournament_match_slot opponent ON opponent.match_id=m.match_id AND opponent.color<>s.color
UNION ALL
SELECT a.tournament_id,a.round_id,a.entrant_id,a.allocation_id,a.awarded_points,a.allocation_type,a.resolved_at,0,NULL
FROM tournament_round_allocation a WHERE a.allocation_type<>'MATCH' AND a.resolution_status='RESOLVED';
