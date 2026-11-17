-- Triggers enforce row/relationship invariants, not Swiss search or Elo math.
-- Business commands must still group all related writes in one transaction.
DELIMITER $$
CREATE PROCEDURE assert_draft_match(IN target VARCHAR(36))
BEGIN
  DECLARE current_status VARCHAR(16);
  SELECT status INTO current_status FROM tournament_match WHERE match_id=target FOR SHARE;
  IF current_status IS NULL OR current_status <> 'DRAFT' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Published match assignments are immutable';
  END IF;
END$$
CREATE TRIGGER guard_slot_insert BEFORE INSERT ON tournament_match_slot FOR EACH ROW
BEGIN CALL assert_draft_match(NEW.match_id); END$$
CREATE TRIGGER guard_slot_delete BEFORE DELETE ON tournament_match_slot FOR EACH ROW
BEGIN CALL assert_draft_match(OLD.match_id); END$$
CREATE TRIGGER guard_slot_update BEFORE UPDATE ON tournament_match_slot FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Replace a draft slot instead of updating its identity'; END$$
CREATE TRIGGER guard_pair_insert BEFORE INSERT ON tournament_opponent_pair FOR EACH ROW
BEGIN CALL assert_draft_match(NEW.match_id); END$$
CREATE TRIGGER guard_pair_delete BEFORE DELETE ON tournament_opponent_pair FOR EACH ROW
BEGIN CALL assert_draft_match(OLD.match_id); END$$
CREATE TRIGGER guard_pair_update BEFORE UPDATE ON tournament_opponent_pair FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Opponent pair identity is immutable'; END$$

CREATE TRIGGER guard_configuration_update BEFORE UPDATE ON tournament_configuration FOR EACH ROW
BEGIN
  IF NEW.tournament_id<>OLD.tournament_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Configuration ownership is immutable'; END IF;
  IF OLD.frozen_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Frozen tournament configuration is immutable'; END IF;
  IF NEW.frozen_at IS NOT NULL THEN
    IF (SELECT COUNT(*) FROM tournament_round WHERE tournament_id=NEW.tournament_id)<>NEW.total_rounds OR EXISTS (SELECT 1 FROM tournament_round r JOIN tournament t ON t.tournament_id=r.tournament_id LEFT JOIN tournament_round p ON p.tournament_id=r.tournament_id AND p.round_number=r.round_number-1 WHERE r.tournament_id=NEW.tournament_id AND (TIMESTAMPDIFF(MICROSECOND,r.scheduled_start_at,r.hard_deadline_at)<>NEW.match_duration_ms*1000 OR (r.round_number=1 AND NOT(r.scheduled_start_at <=> t.tour_start_day)) OR (r.round_number=NEW.total_rounds AND NOT(r.hard_deadline_at <=> t.tour_end_day)) OR (r.round_number>1 AND (p.round_id IS NULL OR TIMESTAMPDIFF(MICROSECOND,p.scheduled_start_at,r.scheduled_start_at)<>(NEW.match_duration_ms+NEW.inter_round_gap_ms)*1000)))) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Frozen configuration requires a complete fixed schedule matching its durations';
    END IF;
  END IF;
END$$
CREATE TRIGGER guard_configuration_delete BEFORE DELETE ON tournament_configuration FOR EACH ROW
BEGIN
  IF OLD.frozen_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Frozen tournament configuration cannot be deleted'; END IF;
END$$
CREATE TRIGGER guard_entrant_update BEFORE UPDATE ON tournament_entrant FOR EACH ROW
BEGIN
  IF NOT (NEW.entrant_id <=> OLD.entrant_id) OR NEW.tournament_id<>OLD.tournament_id OR NEW.entrant_kind<>OLD.entrant_kind OR NEW.registered_at<>OLD.registered_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Entrant identity is immutable';
  END IF;
  IF OLD.registration_status='WITHDRAWN' AND (NEW.registration_status<>'WITHDRAWN' OR NOT (NEW.withdrawn_at <=> OLD.withdrawn_at)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Withdrawal is permanent';
  END IF;
  IF OLD.seed_number IS NOT NULL AND NOT (NEW.seed_number <=> OLD.seed_number) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Published seed is immutable';
  END IF;
END$$
CREATE TRIGGER guard_entrant_delete BEFORE DELETE ON tournament_entrant FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Withdraw entrants instead of deleting registration history'; END$$
CREATE TRIGGER guard_registration_update BEFORE UPDATE ON tournament_player_registration FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Registration identity is immutable'; END$$
CREATE TRIGGER guard_registration_delete BEFORE DELETE ON tournament_player_registration FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Registration history cannot be deleted'; END$$

CREATE TRIGGER guard_round_insert BEFORE INSERT ON tournament_round FOR EACH ROW
BEGIN
  DECLARE rounds_count INT;
  SELECT total_rounds INTO rounds_count FROM tournament_configuration WHERE tournament_id=NEW.tournament_id;
  IF NEW.status<>'SCHEDULED' OR rounds_count IS NULL OR NEW.round_number>rounds_count THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rounds start SCHEDULED within configured round count';
  END IF;
END$$
CREATE TRIGGER guard_round_update BEFORE UPDATE ON tournament_round FOR EACH ROW
BEGIN
  DECLARE is_frozen INT;
  DECLARE missing INT;
  SELECT COUNT(*) INTO is_frozen FROM tournament_configuration WHERE tournament_id=OLD.tournament_id AND frozen_at IS NOT NULL;
  IF NEW.round_id<>OLD.round_id OR NEW.tournament_id<>OLD.tournament_id OR NEW.round_number<>OLD.round_number THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Round identity is immutable';
  END IF;
  IF (is_frozen>0 OR OLD.status<>'SCHEDULED') AND (NEW.scheduled_start_at<>OLD.scheduled_start_at OR NEW.hard_deadline_at<>OLD.hard_deadline_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fixed round schedule is immutable';
  END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='SCHEDULED' AND NEW.status IN ('PAIRED','FAILED','CANCELLED')) OR (OLD.status='PAIRED' AND NEW.status IN ('IN_PROGRESS','FAILED','CANCELLED')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('COMPLETED','FAILED'))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid round state transition';
  END IF;
  IF NEW.status='PAIRED' AND OLD.status='SCHEDULED' THEN
    IF is_frozen=0 OR NEW.pairings_published_at IS NULL OR NEW.pairing_input_hash IS NULL OR NEW.pairing_algorithm_version IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Pairing publication requires frozen rules and pairing provenance';
    END IF;
    SELECT COUNT(*) INTO missing FROM tournament_entrant e LEFT JOIN tournament_player_registration p ON p.entrant_id=e.entrant_id LEFT JOIN tournament_round_allocation a ON a.entrant_id=e.entrant_id AND a.round_id=NEW.round_id WHERE e.tournament_id=NEW.tournament_id AND e.seed_number IS NOT NULL AND (p.entrant_id IS NULL OR a.allocation_id IS NULL);
    IF missing>0 OR NOT EXISTS (SELECT 1 FROM tournament_round_allocation WHERE round_id=NEW.round_id) OR EXISTS (SELECT 1 FROM tournament_match WHERE round_id=NEW.round_id AND status='DRAFT') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Round publication has missing registrations, allocations or draft fixtures';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_round_allocation a LEFT JOIN tournament_match_slot s ON s.allocation_id=a.allocation_id WHERE a.round_id=NEW.round_id AND a.allocation_type='MATCH' AND s.slot_id IS NULL) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Match allocation lacks its fixture slot';
    END IF;
  END IF;
  IF NEW.status='IN_PROGRESS' AND (NEW.actual_started_at IS NULL OR NEW.actual_started_at<NEW.scheduled_start_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Round cannot start before fixed start time';
  END IF;
  IF NEW.status='COMPLETED' AND (EXISTS (SELECT 1 FROM tournament_match WHERE round_id=NEW.round_id AND status<>'FINALIZED') OR EXISTS (SELECT 1 FROM tournament_round_allocation WHERE round_id=NEW.round_id AND resolution_status<>'RESOLVED')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Round has unresolved fixtures or allocations';
  END IF;
END$$
CREATE TRIGGER guard_round_delete BEFORE DELETE ON tournament_round FOR EACH ROW
BEGIN
  IF OLD.status<>'SCHEDULED' OR EXISTS (SELECT 1 FROM tournament_configuration WHERE tournament_id=OLD.tournament_id AND frozen_at IS NOT NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Published round cannot be deleted';
  END IF;
END$$

CREATE TRIGGER guard_allocation_insert BEFORE INSERT ON tournament_round_allocation FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tournament_round WHERE round_id=NEW.round_id AND status='SCHEDULED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Allocations require an unpublished round';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tournament_entrant WHERE entrant_id=NEW.entrant_id AND seed_number IS NOT NULL AND ((NEW.allocation_type='WITHDRAWN' AND registration_status='WITHDRAWN') OR (NEW.allocation_type<>'WITHDRAWN' AND registration_status='REGISTERED'))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Allocation requires seeded entrant with matching registration status';
  END IF;
  IF NEW.allocation_type='REQUESTED_BYE' AND NOT EXISTS (SELECT 1 FROM tournament_configuration WHERE tournament_id=NEW.tournament_id AND requested_byes_enabled=1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Requested byes are disabled';
  END IF;
END$$
CREATE TRIGGER guard_allocation_update BEFORE UPDATE ON tournament_round_allocation FOR EACH ROW
BEGIN
  IF NEW.allocation_id<>OLD.allocation_id OR NEW.tournament_id<>OLD.tournament_id OR NEW.round_id<>OLD.round_id OR NEW.entrant_id<>OLD.entrant_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Allocation identity is immutable';
  END IF;
  IF OLD.resolution_status='RESOLVED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolved allocation is immutable'; END IF;
  IF (NEW.allocation_type<>OLD.allocation_type OR NOT (NEW.awarded_points <=> OLD.awarded_points)) AND NOT (OLD.allocation_type='PAIRING_BYE' AND NEW.allocation_type='WITHDRAWN' AND EXISTS (SELECT 1 FROM tournament_entrant WHERE entrant_id=OLD.entrant_id AND registration_status='WITHDRAWN')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Published award may only change to a withdrawn zero-point award';
  END IF;
  IF NEW.resolution_status='RESOLVED' THEN
    IF NEW.allocation_type='MATCH' AND NOT EXISTS (SELECT 1 FROM tournament_match_slot s JOIN game_result r ON r.tournament_match_id=s.match_id WHERE s.allocation_id=OLD.allocation_id AND r.effective_at=NEW.resolved_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Match allocation requires its authoritative result';
    END IF;
    IF NEW.allocation_type<>'MATCH' AND EXISTS (SELECT 1 FROM tournament_round WHERE round_id=NEW.round_id AND scheduled_start_at>NEW.resolved_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Bye cannot take effect before round start';
    END IF;
  END IF;
END$$

CREATE TRIGGER guard_match_insert BEFORE INSERT ON tournament_match FOR EACH ROW
BEGIN IF NEW.status<>'DRAFT' OR NOT EXISTS (SELECT 1 FROM tournament_round WHERE round_id=NEW.round_id AND status='SCHEDULED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='New fixture must start DRAFT in an unpublished round'; END IF; END$$
CREATE TRIGGER guard_match_update BEFORE UPDATE ON tournament_match FOR EACH ROW
BEGIN
  IF NEW.match_id<>OLD.match_id OR NEW.tournament_id<>OLD.tournament_id OR NEW.round_id<>OLD.round_id OR NEW.board_number<>OLD.board_number THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fixture identity is immutable';
  END IF;
  IF OLD.actual_started_at IS NOT NULL AND NOT(NEW.actual_started_at <=> OLD.actual_started_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Recorded match start is immutable'; END IF;
  IF OLD.status='FINALIZED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Finalized fixture is immutable'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status='WAITING') OR (OLD.status='WAITING' AND NEW.status IN ('IN_PROGRESS','FINALIZED')) OR (OLD.status='IN_PROGRESS' AND NEW.status='FINALIZED')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid fixture transition';
  END IF;
  IF NEW.status='WAITING' AND ((SELECT COUNT(*) FROM tournament_match_slot WHERE match_id=NEW.match_id)<>2 OR NOT EXISTS (SELECT 1 FROM tournament_opponent_pair WHERE match_id=NEW.match_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fixture publication requires two slots and a unique opponent pair';
  END IF;
  IF NEW.status='IN_PROGRESS' AND NOT EXISTS (SELECT 1 FROM tournament_round WHERE round_id=NEW.round_id AND status='IN_PROGRESS' AND scheduled_start_at<=NEW.actual_started_at AND hard_deadline_at>NEW.actual_started_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fixture must start inside its active round window';
  END IF;
  IF NEW.status='FINALIZED' THEN
    IF NOT EXISTS (SELECT 1 FROM game_result r JOIN rating_settlement rs ON rs.result_id=r.result_id AND rs.status='APPLIED' WHERE r.tournament_match_id=NEW.match_id AND r.effective_at=NEW.finalized_at) OR EXISTS (SELECT 1 FROM game_session WHERE tournament_match_id=NEW.match_id AND status<>'FINALIZED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fixture finalization requires result, settled rating decision and closed game';
    END IF;
  END IF;
END$$

CREATE TRIGGER guard_participant_insert BEFORE INSERT ON game_participant FOR EACH ROW
BEGIN
  DECLARE session_origin VARCHAR(16);
  SELECT origin INTO session_origin FROM game_session WHERE game_session_id=NEW.game_session_id FOR SHARE;
  IF (session_origin='TOURNAMENT' AND NEW.slot_id IS NULL) OR (session_origin='QUICK_PLAY' AND NEW.slot_id IS NOT NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Participant context does not match game origin';
  END IF;
END$$
CREATE TRIGGER guard_participant_update BEFORE UPDATE ON game_participant FOR EACH ROW
BEGIN
  IF NEW.participant_id<>OLD.participant_id OR NEW.game_session_id<>OLD.game_session_id OR NEW.color<>OLD.color OR NOT (NEW.player_id <=> OLD.player_id) OR NOT (NEW.guest_label <=> OLD.guest_label) OR NOT (NEW.slot_id <=> OLD.slot_id) OR NOT (NEW.entrant_id <=> OLD.entrant_id) OR NOT (NEW.tournament_match_id <=> OLD.tournament_match_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Game participant identity is immutable';
  END IF;
  IF NEW.reconnect_deadline_at IS NOT NULL AND NEW.tournament_match_id IS NOT NULL AND EXISTS (SELECT 1 FROM tournament_match m JOIN tournament_round r ON r.round_id=m.round_id WHERE m.match_id=NEW.tournament_match_id AND NEW.reconnect_deadline_at>r.hard_deadline_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Reconnect window cannot exceed match deadline'; END IF;
END$$
CREATE TRIGGER guard_participant_delete BEFORE DELETE ON game_participant FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Game participant history cannot be deleted'; END$$

CREATE TRIGGER guard_session_insert BEFORE INSERT ON game_session FOR EACH ROW
BEGIN IF NEW.status<>'WAITING' OR NEW.current_move_sequence<>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='New game must start WAITING at sequence zero'; END IF; END$$
CREATE TRIGGER guard_session_update BEFORE UPDATE ON game_session FOR EACH ROW
BEGIN
  IF NEW.game_session_id<>OLD.game_session_id OR NEW.origin<>OLD.origin OR NOT (NEW.tournament_match_id <=> OLD.tournament_match_id) OR NEW.engine_ruleset_version<>OLD.engine_ruleset_version THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Game origin and engine version are immutable';
  END IF;
  IF OLD.started_at IS NOT NULL AND NOT(NEW.started_at <=> OLD.started_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Recorded game start is immutable'; END IF;
  IF OLD.status='FINALIZED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Finalized game is immutable'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='WAITING' AND NEW.status IN ('IN_PROGRESS','FINALIZED')) OR (OLD.status='IN_PROGRESS' AND NEW.status='FINALIZED')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid game transition';
  END IF;
  IF NEW.status='IN_PROGRESS' AND (SELECT COUNT(*) FROM game_participant WHERE game_session_id=NEW.game_session_id)<>2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Playing game requires two assigned participants';
  END IF;
  IF NEW.status='IN_PROGRESS' AND NEW.origin='TOURNAMENT' AND NOT EXISTS (SELECT 1 FROM tournament_match WHERE match_id=NEW.tournament_match_id AND status='IN_PROGRESS' AND actual_started_at=NEW.started_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tournament session start must match its playing fixture'; END IF;
  IF NEW.current_move_sequence<>OLD.current_move_sequence AND (NEW.current_move_sequence<>OLD.current_move_sequence+1 OR NEW.current_move_sequence<>(SELECT COALESCE(MAX(move_sequence),0) FROM game_move WHERE game_session_id=NEW.game_session_id) OR NEW.side_to_move=OLD.side_to_move) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Move sequence/turn must advance with its journal entry';
  END IF;
  IF NEW.side_to_move<>OLD.side_to_move AND NEW.current_move_sequence=OLD.current_move_sequence THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Side to move cannot change without a journaled move'; END IF;
  IF NEW.status='FINALIZED' AND NEW.current_move_sequence<>(SELECT COALESCE(MAX(move_sequence),0) FROM game_move WHERE game_session_id=NEW.game_session_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Cannot close a game with uncommitted move sequence'; END IF;
  IF NEW.status='FINALIZED' AND NOT EXISTS (SELECT 1 FROM game_result r JOIN rating_settlement rs ON rs.result_id=r.result_id AND rs.status='APPLIED' WHERE r.effective_at=NEW.finished_at AND (r.game_session_id=NEW.game_session_id OR (NEW.tournament_match_id IS NOT NULL AND r.tournament_match_id=NEW.tournament_match_id))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Game closure requires authoritative result and rating decision';
  END IF;
END$$

CREATE TRIGGER guard_move_insert BEFORE INSERT ON game_move FOR EACH ROW
BEGIN
  DECLARE sequence_value INT;
  DECLARE session_state VARCHAR(16);
  DECLARE expected_color VARCHAR(5);
  DECLARE actor_color VARCHAR(5);
  SELECT current_move_sequence,status,side_to_move INTO sequence_value,session_state,expected_color FROM game_session WHERE game_session_id=NEW.game_session_id FOR UPDATE;
  SELECT color INTO actor_color FROM game_participant WHERE participant_id=NEW.participant_id AND game_session_id=NEW.game_session_id;
  IF session_state<>'IN_PROGRESS' OR NEW.move_sequence<>sequence_value+1 OR actor_color<>expected_color OR EXISTS (SELECT 1 FROM game_result WHERE game_session_id=NEW.game_session_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Move requires an unfinished playing session, next sequence and correct side';
  END IF;
END$$
CREATE TRIGGER guard_move_update BEFORE UPDATE ON game_move FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Accepted move journal is append-only'; END$$
CREATE TRIGGER guard_move_delete BEFORE DELETE ON game_move FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Accepted move journal is append-only'; END$$
CREATE TRIGGER guard_receipt_update BEFORE UPDATE ON game_command_receipt FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Accepted command receipt is immutable'; END$$
CREATE TRIGGER guard_receipt_delete BEFORE DELETE ON game_command_receipt FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Accepted command receipt is immutable'; END$$

CREATE TRIGGER guard_result_insert BEFORE INSERT ON game_result FOR EACH ROW
BEGIN
  DECLARE match_state VARCHAR(16);
  DECLARE match_started DATETIME(3);
  DECLARE deadline_value DATETIME(3);
  IF NEW.game_session_id IS NOT NULL AND EXISTS (SELECT 1 FROM game_session g WHERE g.game_session_id=NEW.game_session_id AND g.current_move_sequence<>(SELECT COALESCE(MAX(m.move_sequence),0) FROM game_move m WHERE m.game_session_id=g.game_session_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Result requires a fully advanced move journal'; END IF;
  IF NEW.game_session_id IS NOT NULL AND EXISTS (SELECT 1 FROM game_session WHERE game_session_id=NEW.game_session_id AND started_at>NEW.effective_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Game result cannot predate its start'; END IF;
  IF NEW.tournament_match_id IS NOT NULL THEN
    SELECT m.status,m.actual_started_at,r.hard_deadline_at INTO match_state,match_started,deadline_value FROM tournament_match m JOIN tournament_round r ON r.round_id=m.round_id WHERE m.match_id=NEW.tournament_match_id FOR SHARE;
    IF match_state NOT IN ('WAITING','IN_PROGRESS') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Result requires a published unfinished fixture'; END IF;
    IF NEW.reason='MATCH_DEADLINE' AND NEW.effective_at<>deadline_value THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Deadline draw must use the fixed hard deadline'; END IF;
    IF NEW.reason<>'MATCH_DEADLINE' AND NEW.effective_at>=deadline_value THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Elapsed match deadline must resolve as a draw'; END IF;
    IF match_started IS NOT NULL AND NEW.game_session_id IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Played fixture result must reference its game'; END IF;
    IF NEW.reason IN ('SINGLE_NO_SHOW','DOUBLE_NO_SHOW') AND match_started IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A started game is not a no-show'; END IF;
  END IF;
  IF NEW.reason IN ('GAME_COMPLETED','RESIGNATION','DRAW_AGREEMENT','RECONNECT_EXPIRED','DOUBLE_DISCONNECT') AND (NEW.game_session_id IS NULL OR NOT EXISTS (SELECT 1 FROM game_session WHERE game_session_id=NEW.game_session_id AND started_at IS NOT NULL)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Played result reason requires a started session';
  END IF;
END$$
CREATE TRIGGER guard_result_update BEFORE UPDATE ON game_result FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Authoritative results are immutable'; END$$
CREATE TRIGGER guard_result_delete BEFORE DELETE ON game_result FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Authoritative results are immutable'; END$$

CREATE TRIGGER guard_policy_update BEFORE UPDATE ON rating_policy FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Create a new rating policy version instead of editing history'; END$$
CREATE TRIGGER guard_policy_delete BEFORE DELETE ON rating_policy FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating policy versions are retained'; END$$
CREATE TRIGGER guard_settlement_insert BEFORE INSERT ON rating_settlement FOR EACH ROW
BEGIN
  IF NEW.status<>'PENDING' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='New settlement must start PENDING'; END IF;
  IF NOT(NEW.game_session_id <=> (SELECT game_session_id FROM game_result WHERE result_id=NEW.result_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Settlement session must match its result including nullability'; END IF;
  IF NEW.rated=1 AND (NOT EXISTS (SELECT 1 FROM game_result r WHERE r.result_id=NEW.result_id AND r.reason IN ('GAME_COMPLETED','RESIGNATION','DRAW_AGREEMENT','MATCH_DEADLINE')) OR (SELECT COUNT(DISTINCT player_id) FROM game_participant WHERE game_session_id=NEW.game_session_id)<>2 OR NEW.move_count<>(SELECT current_move_sequence FROM game_session WHERE game_session_id=NEW.game_session_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rated settlement requires played eligible result and two distinct accounts';
  END IF;
END$$
CREATE TRIGGER guard_settlement_update BEFORE UPDATE ON rating_settlement FOR EACH ROW
BEGIN
  IF OLD.status<>'PENDING' OR NEW.status<>'APPLIED' OR NEW.settlement_id<>OLD.settlement_id OR NEW.result_id<>OLD.result_id OR NOT (NEW.game_session_id <=> OLD.game_session_id) OR NEW.policy_version<>OLD.policy_version OR NEW.rated<>OLD.rated OR NEW.move_count<>OLD.move_count OR NOT (NEW.exclusion_reason <=> OLD.exclusion_reason) OR NEW.settlement_sequence<>OLD.settlement_sequence THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Settlement only permits PENDING to APPLIED without changing decision';
  END IF;
  IF NEW.rated=1 AND ((SELECT COUNT(*) FROM player_rating_change WHERE settlement_id=NEW.settlement_id)<>2 OR (SELECT COALESCE(SUM(rating_delta),1) FROM player_rating_change WHERE settlement_id=NEW.settlement_id)<>0 OR EXISTS (SELECT 1 FROM player_rating_change c JOIN player_rating p ON p.player_id=c.player_id WHERE c.settlement_id=NEW.settlement_id AND (p.rating<>c.rating_after OR p.lock_version<>c.player_rating_version))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rated settlement requires both zero-sum changes and both updated profiles';
  END IF;
  IF NEW.rated=0 AND EXISTS (SELECT 1 FROM player_rating_change WHERE settlement_id=NEW.settlement_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Unrated settlement cannot have Elo changes'; END IF;
END$$
CREATE TRIGGER guard_settlement_delete BEFORE DELETE ON rating_settlement FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating decisions are retained'; END$$
CREATE TRIGGER guard_change_insert BEFORE INSERT ON player_rating_change FOR EACH ROW
BEGIN
  DECLARE decision_rated TINYINT;
  DECLARE decision_status VARCHAR(8);
  SELECT rated,status INTO decision_rated,decision_status FROM rating_settlement WHERE settlement_id=NEW.settlement_id FOR UPDATE;
  IF decision_rated<>1 OR decision_status<>'PENDING' OR NOT EXISTS (SELECT 1 FROM player_rating WHERE player_id=NEW.player_id AND rating=NEW.rating_before AND lock_version+1=NEW.player_rating_version) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating change requires pending rated decision and current pre-game profile';
  END IF;
END$$
CREATE TRIGGER guard_change_update BEFORE UPDATE ON player_rating_change FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating change history is immutable'; END$$
CREATE TRIGGER guard_change_delete BEFORE DELETE ON player_rating_change FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating change history is immutable'; END$$
CREATE TRIGGER guard_rating_update BEFORE UPDATE ON player_rating FOR EACH ROW
BEGIN
  IF NEW.player_id<>OLD.player_id OR NEW.initial_policy_version<>OLD.initial_policy_version OR NEW.initial_rating<>OLD.initial_rating OR NEW.initialized_at<>OLD.initialized_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating account identity and opening balance are immutable'; END IF;
  IF NEW.lock_version<>OLD.lock_version+1 OR NEW.rated_games<>OLD.rated_games+1 OR NOT EXISTS (SELECT 1 FROM player_rating_change c JOIN rating_settlement s ON s.settlement_id=c.settlement_id JOIN game_result r ON r.result_id=s.result_id WHERE c.player_id=NEW.player_id AND c.player_rating_version=NEW.lock_version AND c.rating_before=OLD.rating AND c.rating_after=NEW.rating AND s.status='PENDING' AND NEW.wins=OLD.wins+IF(IF(c.color='WHITE',r.white_points,r.black_points)=1,1,0) AND NEW.draws=OLD.draws+IF(r.outcome='DRAW',1,0) AND NEW.losses=OLD.losses+IF(IF(c.color='WHITE',r.white_points,r.black_points)=0,1,0)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating profile update must correspond to exactly one pending history entry';
  END IF;
END$$
CREATE TRIGGER guard_rating_insert BEFORE INSERT ON player_rating FOR EACH ROW
BEGIN IF NEW.rating<>NEW.initial_rating OR NEW.rated_games<>0 OR NEW.lock_version<>0 OR NOT EXISTS (SELECT 1 FROM rating_policy WHERE policy_version=NEW.initial_policy_version AND initial_rating=NEW.initial_rating) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating account starts from its policy opening balance; import history explicitly'; END IF; END$$
CREATE TRIGGER guard_outbox_insert BEFORE INSERT ON outbox_event FOR EACH ROW
BEGIN IF NEW.tournament_id IS NOT NULL AND NEW.game_session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM game_session g JOIN tournament_match m ON m.match_id=g.tournament_match_id WHERE g.game_session_id=NEW.game_session_id AND m.tournament_id=NEW.tournament_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Outbox game belongs to another tournament'; END IF; END$$
CREATE TRIGGER guard_tournament_update BEFORE UPDATE ON tournament FOR EACH ROW
BEGIN
  IF NEW.tournament_id<>OLD.tournament_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tournament identity is immutable'; END IF;
  IF EXISTS (SELECT 1 FROM tournament_configuration WHERE tournament_id=OLD.tournament_id AND frozen_at IS NOT NULL) AND (NOT(NEW.tour_start_day <=> OLD.tour_start_day) OR NOT(NEW.tour_end_day <=> OLD.tour_end_day) OR NOT(NEW.registration_opens_at <=> OLD.registration_opens_at) OR NOT(NEW.registration_closes_at <=> OLD.registration_closes_at) OR NEW.tourtypeID<>OLD.tourtypeID OR NEW.tour_version<>OLD.tour_version) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Frozen tournament schedule and edition are immutable'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status IN ('REGISTRATION_OPEN','CANCELLED','FAILED')) OR (OLD.status='REGISTRATION_OPEN' AND NEW.status IN ('READY','FAILED','CANCELLED')) OR (OLD.status='READY' AND NEW.status IN ('IN_PROGRESS','FAILED','CANCELLED')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('COMPLETED','FAILED'))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid tournament transition'; END IF;
  IF NEW.status='REGISTRATION_OPEN' AND (NEW.registration_opens_at IS NULL OR NEW.registration_closes_at IS NULL OR NEW.tour_start_day IS NULL OR NEW.registration_closes_at>=NEW.tour_start_day OR NOT EXISTS (SELECT 1 FROM tournament_configuration WHERE tournament_id=NEW.tournament_id AND frozen_at IS NOT NULL)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Registration requires frozen configuration and a valid registration window'; END IF;
  IF NEW.status='COMPLETED' AND (EXISTS (SELECT 1 FROM tournament_round WHERE tournament_id=NEW.tournament_id AND status<>'COMPLETED') OR (SELECT COUNT(*) FROM tournament_final_standing WHERE tournament_id=NEW.tournament_id)<>(SELECT COUNT(*) FROM tournament_entrant WHERE tournament_id=NEW.tournament_id AND seed_number IS NOT NULL) OR NEW.completed_at IS NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tournament completion requires resolved rounds and final standings'; END IF;
END$$
CREATE TRIGGER guard_allocation_delete BEFORE DELETE ON tournament_round_allocation FOR EACH ROW
BEGIN
  IF OLD.resolution_status='RESOLVED' OR NOT EXISTS (SELECT 1 FROM tournament_round WHERE round_id=OLD.round_id AND status='SCHEDULED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Published allocations cannot be deleted'; END IF;
END$$
CREATE TRIGGER guard_match_delete BEFORE DELETE ON tournament_match FOR EACH ROW
BEGIN IF OLD.status<>'DRAFT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Published fixture cannot be deleted'; END IF; END$$
CREATE TRIGGER guard_session_delete BEFORE DELETE ON game_session FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Game session history cannot be deleted'; END$$
CREATE TRIGGER guard_rating_delete BEFORE DELETE ON player_rating FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rating history cannot be reset by deleting a profile'; END$$
CREATE TRIGGER guard_standing_update BEFORE UPDATE ON tournament_final_standing FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Final standing snapshots are immutable'; END$$
CREATE TRIGGER guard_standing_delete BEFORE DELETE ON tournament_final_standing FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Final standing snapshots are retained'; END$$

CREATE PROCEDURE assert_legacy_team_result(IN fixture_id VARCHAR(36), IN winner_id VARCHAR(36), IN loser_id VARCHAR(36))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tourteam_matches WHERE TourTeamMatches_id=fixture_id AND (winner_id IS NULL OR winner_id IN (tourteam1,tourteam2)) AND (loser_id IS NULL OR loser_id IN (tourteam1,tourteam2))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Legacy team result references an unrelated team'; END IF;
END$$
CREATE TRIGGER guard_legacy_team_result_insert BEFORE INSERT ON tourteam_match_details FOR EACH ROW
BEGIN CALL assert_legacy_team_result(NEW.tourteam_matchID,NEW.winner_team,NEW.losing_team); END$$
CREATE TRIGGER guard_legacy_team_result_update BEFORE UPDATE ON tourteam_match_details FOR EACH ROW
BEGIN CALL assert_legacy_team_result(NEW.tourteam_matchID,NEW.winner_team,NEW.losing_team); END$$
CREATE PROCEDURE assert_legacy_board_result(IN fixture_id VARCHAR(36), IN white_id VARCHAR(36), IN black_id VARCHAR(36), IN winner_id VARCHAR(36), IN loser_id VARCHAR(36))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tourteam_player_matches WHERE tourteam_player_matches_id=fixture_id AND white_id IN (player1,player2) AND black_id IN (player1,player2) AND white_id<>black_id AND (winner_id IS NULL OR winner_id IN (player1,player2)) AND (loser_id IS NULL OR loser_id IN (player1,player2))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Legacy board result references an unrelated player'; END IF;
END$$
CREATE TRIGGER guard_legacy_board_result_insert BEFORE INSERT ON tourteam_player_match_details FOR EACH ROW
BEGIN CALL assert_legacy_board_result(NEW.tourteam_player_matchID,NEW.white_pieces_player,NEW.black_pieces_player,NEW.winning_player,NEW.losing_player); END$$
CREATE TRIGGER guard_legacy_board_result_update BEFORE UPDATE ON tourteam_player_match_details FOR EACH ROW
BEGIN CALL assert_legacy_board_result(NEW.tourteam_player_matchID,NEW.white_pieces_player,NEW.black_pieces_player,NEW.winning_player,NEW.losing_player); END$$
CREATE PROCEDURE assert_legacy_move_actor(IN fixture_id VARCHAR(36), IN actor_id VARCHAR(36))
BEGIN IF NOT EXISTS (SELECT 1 FROM tourteam_player_matches WHERE tourteam_player_matches_id=fixture_id AND actor_id IN (player1,player2)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Legacy move actor is not assigned to the board'; END IF; END$$
CREATE TRIGGER guard_legacy_move_insert BEFORE INSERT ON tournament_match_moves FOR EACH ROW
BEGIN CALL assert_legacy_move_actor(NEW.ttPlayerMatchesID,NEW.tourTeamStateID); END$$
CREATE TRIGGER guard_legacy_move_update BEFORE UPDATE ON tournament_match_moves FOR EACH ROW
BEGIN CALL assert_legacy_move_actor(NEW.ttPlayerMatchesID,NEW.tourTeamStateID); END$$
CREATE TRIGGER guard_legacy_match_identity BEFORE UPDATE ON tourteam_matches FOR EACH ROW
BEGIN IF NEW.TourTeamMatches_id<>OLD.TourTeamMatches_id OR NEW.tourID<>OLD.tourID OR NEW.tourteam1<>OLD.tourteam1 OR NEW.tourteam2<>OLD.tourteam2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Legacy team fixture assignments are immutable'; END IF; END$$
CREATE TRIGGER guard_legacy_board_identity BEFORE UPDATE ON tourteam_player_matches FOR EACH ROW
BEGIN IF NEW.tourteam_player_matches_id<>OLD.tourteam_player_matches_id OR NEW.tourteam_matchID<>OLD.tourteam_matchID OR NEW.player1<>OLD.player1 OR NEW.player2<>OLD.player2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Legacy board fixture assignments are immutable'; END IF; END$$
CREATE TRIGGER guard_legacy_roster_identity BEFORE UPDATE ON tourteamstate FOR EACH ROW
BEGIN IF NEW.TourTeamState_id<>OLD.TourTeamState_id OR NEW.tourteamID<>OLD.tourteamID OR NEW.playerID<>OLD.playerID OR NEW.tourID<>OLD.tourID THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tournament roster identity is immutable'; END IF; END$$
CREATE TRIGGER guard_legacy_team_registration_identity BEFORE UPDATE ON tourteams FOR EACH ROW
BEGIN IF NEW.TourTeams_id<>OLD.TourTeams_id OR NEW.tourID<>OLD.tourID OR NEW.teamID<>OLD.teamID THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tournament team registration identity is immutable'; END IF; END$$
CREATE PROCEDURE assert_unfrozen_rules(IN tournament_id_value VARCHAR(36))
BEGIN IF EXISTS (SELECT 1 FROM tournament_configuration WHERE tournament_id=tournament_id_value AND frozen_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Frozen tournament rule bindings are immutable'; END IF; END$$
CREATE TRIGGER guard_rule_binding_insert BEFORE INSERT ON this_tournament_rules FOR EACH ROW
BEGIN CALL assert_unfrozen_rules(NEW.tournamentID); END$$
CREATE TRIGGER guard_rule_binding_update BEFORE UPDATE ON this_tournament_rules FOR EACH ROW
BEGIN CALL assert_unfrozen_rules(OLD.tournamentID); CALL assert_unfrozen_rules(NEW.tournamentID); END$$
CREATE TRIGGER guard_rule_binding_delete BEFORE DELETE ON this_tournament_rules FOR EACH ROW
BEGIN CALL assert_unfrozen_rules(OLD.tournamentID); END$$
CREATE TRIGGER guard_ruleset_update BEFORE UPDATE ON ruleset FOR EACH ROW
BEGIN IF EXISTS (SELECT 1 FROM tournament_rules r JOIN this_tournament_rules b ON b.tournament_rulesID=r.tournament_rules_id JOIN tournament_configuration c ON c.tournament_id=b.tournamentID WHERE r.rulesetID=OLD.ruleset_id AND c.frozen_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Create a new version of a rule used by a frozen tournament'; END IF; END$$
CREATE TRIGGER guard_tournament_rule_update BEFORE UPDATE ON tournament_rules FOR EACH ROW
BEGIN IF EXISTS (SELECT 1 FROM this_tournament_rules b JOIN tournament_configuration c ON c.tournament_id=b.tournamentID WHERE b.tournament_rulesID=OLD.tournament_rules_id AND c.frozen_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Frozen rule consideration and catalog association are immutable'; END IF; END$$
CREATE TRIGGER guard_format_update BEFORE UPDATE ON tournament_format FOR EACH ROW
BEGIN IF EXISTS (SELECT 1 FROM tournament_configuration WHERE format_code=OLD.format_code AND frozen_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Format strategy used by a frozen tournament is immutable'; END IF; END$$
DELIMITER ;
