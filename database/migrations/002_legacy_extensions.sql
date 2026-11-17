-- Additive adaptation of the supplied tables. No table or legacy row is deleted.
-- Existing data must pass tools/preflight.js before these non-transactional DDLs.
ALTER TABLE player
  MODIFY first_name VARCHAR(25) NULL,
  MODIFY last_name VARCHAR(25) NULL,
  MODIFY username VARCHAR(64) NOT NULL,
  MODIFY _password VARCHAR(255) NOT NULL,
  ADD account_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  ADD created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD CONSTRAINT ck_player_status CHECK (account_status IN ('ACTIVE','DISABLED','ANONYMIZED'));

ALTER TABLE player_history
  ALTER matches_played SET DEFAULT 0,
  ALTER tournaments_played SET DEFAULT 0,
  ADD CONSTRAINT ck_player_history_counts CHECK (matches_played >= 0 AND tournaments_played >= 0);
ALTER TABLE player_accesslog ADD INDEX ix_player_access_time (playerID, login_time);
ALTER TABLE tournament
  MODIFY tour_name VARCHAR(120) NOT NULL,
  MODIFY tour_start_day DATETIME(3) NULL,
  MODIFY tour_end_day DATETIME(3) NULL,
  ALTER number_of_teams SET DEFAULT 0,
  ALTER number_of_players SET DEFAULT 0,
  ADD status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  ADD registration_opens_at DATETIME(3) NULL,
  ADD registration_closes_at DATETIME(3) NULL,
  ADD provision_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD competition_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD lock_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD completed_at DATETIME(3) NULL,
  ADD failure_code VARCHAR(64) NULL,
  ADD UNIQUE KEY uq_tournament_provision (provision_key),
  ADD INDEX ix_tournament_status_start (status, tour_start_day),
  ADD CONSTRAINT ck_tournament_counts CHECK (number_of_teams >= 0 AND number_of_players >= 0),
  ADD CONSTRAINT ck_tournament_state CHECK (status IN ('DRAFT','REGISTRATION_OPEN','READY','IN_PROGRESS','COMPLETED','FAILED','CANCELLED')),
  ADD CONSTRAINT ck_tournament_registration CHECK (registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_opens_at < registration_closes_at),
  ADD CONSTRAINT ck_tournament_dates CHECK (tour_start_day IS NULL OR tour_end_day IS NULL OR tour_start_day < tour_end_day);

ALTER TABLE teams ADD CONSTRAINT ck_teams_size CHECK (number_of_players >= 0);
ALTER TABLE team_history ADD CONSTRAINT ck_team_history_count CHECK (number_of_tournaments IS NULL OR number_of_tournaments >= 0);
ALTER TABLE team_criteria
  ADD CONSTRAINT ck_team_criteria_rank CHECK (minimum_ranking >= 0 AND (maximum_ranking IS NULL OR maximum_ranking >= minimum_ranking)),
  ADD CONSTRAINT ck_team_criteria_size CHECK ((minimum_players_number IS NULL OR minimum_players_number >= 0) AND (maximum_players_number IS NULL OR maximum_players_number >= 0) AND (minimum_players_number IS NULL OR maximum_players_number IS NULL OR minimum_players_number <= maximum_players_number));
ALTER TABLE tour_criteria ADD CONSTRAINT ck_tour_criteria_range CHECK ((MinimumRanking IS NULL OR MinimumRanking >= 0) AND (MaximumRanking IS NULL OR MaximumRanking >= 0) AND (MinimumRanking IS NULL OR MaximumRanking IS NULL OR MinimumRanking <= MaximumRanking));

-- Complete unique keys are intentional: MySQL 8.4 forbids nonstandard parent keys.
ALTER TABLE tourteams ADD UNIQUE KEY uq_tourteams_scope (TourTeams_id, tourID);
ALTER TABLE tourteamstate ADD tourID VARCHAR(36) NULL;
UPDATE tourteamstate s JOIN tourteams t ON t.TourTeams_id = s.tourteamID SET s.tourID = t.tourID;
ALTER TABLE tourteamstate
  MODIFY tourID VARCHAR(36) NOT NULL,
  ADD UNIQUE KEY uq_roster_team (TourTeamState_id, tourteamID),
  ADD UNIQUE KEY uq_roster_tournament (TourTeamState_id, tourID),
  ADD CONSTRAINT fk_roster_scope FOREIGN KEY (tourteamID, tourID) REFERENCES tourteams (TourTeams_id, tourID);

ALTER TABLE tourteam_matches
  ADD UNIQUE KEY uq_team_match_scope (TourTeamMatches_id, tourID),
  ADD UNIQUE KEY uq_team_match_sides (TourTeamMatches_id, tourID, tourteam1, tourteam2),
  ADD CONSTRAINT ck_team_match_distinct CHECK (tourteam1 <> tourteam2),
  ADD CONSTRAINT ck_team_match_times CHECK (start_time < end_time),
  ADD CONSTRAINT fk_team_match_first_scope FOREIGN KEY (tourteam1, tourID) REFERENCES tourteams (TourTeams_id, tourID),
  ADD CONSTRAINT fk_team_match_second_scope FOREIGN KEY (tourteam2, tourID) REFERENCES tourteams (TourTeams_id, tourID);

ALTER TABLE tourteam_player_matches
  ADD tourID VARCHAR(36) NULL,
  ADD tourteam1_id VARCHAR(36) NULL,
  ADD tourteam2_id VARCHAR(36) NULL,
  ADD scheduled_start_at DATETIME(3) NULL;
-- The original VARCHAR start_time is retained verbatim. Its timezone/encoding
-- is not guessed; scheduled_start_at needs a separately reviewed data backfill.
UPDATE tourteam_player_matches p JOIN tourteam_matches m ON m.TourTeamMatches_id = p.tourteam_matchID
  SET p.tourID = m.tourID, p.tourteam1_id = m.tourteam1, p.tourteam2_id = m.tourteam2;
ALTER TABLE tourteam_player_matches
  MODIFY tourID VARCHAR(36) NOT NULL,
  MODIFY tourteam1_id VARCHAR(36) NOT NULL,
  MODIFY tourteam2_id VARCHAR(36) NOT NULL,
  ADD UNIQUE KEY uq_team_board_scope (tourteam_player_matches_id, tourID),
  ADD CONSTRAINT ck_team_board_distinct CHECK (player1 <> player2),
  ADD CONSTRAINT ck_team_board_duration CHECK (time_period > 0),
  ADD CONSTRAINT fk_team_board_parent FOREIGN KEY (tourteam_matchID, tourID, tourteam1_id, tourteam2_id) REFERENCES tourteam_matches (TourTeamMatches_id, tourID, tourteam1, tourteam2),
  ADD CONSTRAINT fk_team_board_player_one FOREIGN KEY (player1, tourteam1_id) REFERENCES tourteamstate (TourTeamState_id, tourteamID),
  ADD CONSTRAINT fk_team_board_player_two FOREIGN KEY (player2, tourteam2_id) REFERENCES tourteamstate (TourTeamState_id, tourteamID);

ALTER TABLE tournament_details ADD CONSTRAINT fk_legacy_winner_scope FOREIGN KEY (winner_team, tourID) REFERENCES tourteams (TourTeams_id, tourID);
ALTER TABLE tourteam_player_match_details
  ADD CONSTRAINT ck_legacy_board_colors CHECK (white_pieces_player <> black_pieces_player),
  ADD CONSTRAINT ck_legacy_board_winner CHECK (winning_player IS NULL OR losing_player IS NULL OR winning_player <> losing_player),
  ADD CONSTRAINT ck_legacy_board_times CHECK (playing_start_time <= playing_end_time);
ALTER TABLE tourteam_match_details ADD CONSTRAINT ck_legacy_team_winner CHECK (winner_team IS NULL OR losing_team IS NULL OR winner_team <> losing_team);

ALTER TABLE tournament_match_moves ADD tourID VARCHAR(36) NULL;
UPDATE tournament_match_moves v JOIN tourteam_player_matches p ON p.tourteam_player_matches_id = v.ttPlayerMatchesID SET v.tourID = p.tourID;
ALTER TABLE tournament_match_moves
  MODIFY tourID VARCHAR(36) NOT NULL,
  ADD CONSTRAINT fk_legacy_move_board_scope FOREIGN KEY (ttPlayerMatchesID, tourID) REFERENCES tourteam_player_matches (tourteam_player_matches_id, tourID),
  ADD CONSTRAINT fk_legacy_move_actor_scope FOREIGN KEY (tourTeamStateID, tourID) REFERENCES tourteamstate (TourTeamState_id, tourID);

ALTER TABLE ruleset
  ADD rule_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD rule_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY uq_rule_version (rule_code, rule_version);
ALTER TABLE this_tournament_rules ADD parameters_json JSON NULL;
