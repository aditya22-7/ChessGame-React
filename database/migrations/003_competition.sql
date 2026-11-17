CREATE TABLE auth_session (
  session_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  player_id VARCHAR(36) NULL,
  session_data JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  KEY ix_auth_expiry (expires_at),
  KEY ix_auth_player (player_id, revoked_at),
  CONSTRAINT fk_auth_player FOREIGN KEY (player_id) REFERENCES player (player_id),
  CONSTRAINT ck_auth_data CHECK (JSON_TYPE(session_data) = 'OBJECT'),
  CONSTRAINT ck_auth_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_format (
  format_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  display_name VARCHAR(80) NOT NULL,
  strategy_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_configuration (
  tournament_id VARCHAR(36) PRIMARY KEY,
  format_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  format_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INDIVIDUAL',
  total_rounds SMALLINT UNSIGNED NOT NULL,
  maximum_entrants INT UNSIGNED NOT NULL,
  match_duration_ms BIGINT UNSIGNED NOT NULL,
  inter_round_gap_ms BIGINT UNSIGNED NOT NULL,
  reconnect_grace_ms BIGINT UNSIGNED NOT NULL DEFAULT 60000,
  initial_seeding_method VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RANDOM',
  pairing_random_seed VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_byes_enabled TINYINT NOT NULL DEFAULT 0,
  withdrawal_policy VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PERMANENT',
  attendance_policy VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'STRICT_START',
  tiebreak_policy_version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_parameters JSON NOT NULL,
  configuration_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  frozen_at DATETIME(3) NULL,
  CONSTRAINT fk_config_tournament FOREIGN KEY (tournament_id) REFERENCES tournament (tournament_id),
  CONSTRAINT fk_config_format FOREIGN KEY (format_code) REFERENCES tournament_format (format_code),
  CONSTRAINT ck_config_kind CHECK (participant_kind = 'INDIVIDUAL'),
  CONSTRAINT ck_config_rounds CHECK (total_rounds BETWEEN 1 AND 100),
  CONSTRAINT ck_config_capacity CHECK (maximum_entrants BETWEEN 2 AND 1024),
  CONSTRAINT ck_config_duration CHECK (match_duration_ms > 0 AND inter_round_gap_ms >= 1000 AND reconnect_grace_ms > 0),
  CONSTRAINT ck_config_policy CHECK (initial_seeding_method = 'RANDOM' AND requested_byes_enabled = 0 AND withdrawal_policy = 'PERMANENT' AND attendance_policy = 'STRICT_START'),
  CONSTRAINT ck_config_parameters CHECK (JSON_TYPE(policy_parameters) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_entrant (
  entrant_id VARCHAR(36) PRIMARY KEY,
  tournament_id VARCHAR(36) NOT NULL,
  entrant_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PLAYER',
  registration_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'REGISTERED',
  registered_at DATETIME(3) NOT NULL,
  withdrawn_at DATETIME(3) NULL,
  seed_number INT UNSIGNED NULL,
  first_participated_at DATETIME(3) NULL,
  lock_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_entrant_scope (entrant_id, tournament_id),
  UNIQUE KEY uq_entrant_seed (tournament_id, seed_number),
  KEY ix_entrant_active (tournament_id, registration_status),
  CONSTRAINT fk_entrant_tournament FOREIGN KEY (tournament_id) REFERENCES tournament (tournament_id),
  CONSTRAINT ck_entrant_kind CHECK (entrant_kind = 'PLAYER'),
  CONSTRAINT ck_entrant_status CHECK ((registration_status = 'REGISTERED' AND withdrawn_at IS NULL) OR (registration_status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL)),
  CONSTRAINT ck_entrant_seed CHECK (seed_number IS NULL OR seed_number > 0),
  CONSTRAINT ck_entrant_withdrawal CHECK (withdrawn_at IS NULL OR withdrawn_at >= registered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_player_registration (
  entrant_id VARCHAR(36) PRIMARY KEY,
  tournament_id VARCHAR(36) NOT NULL,
  player_id VARCHAR(36) NOT NULL,
  UNIQUE KEY uq_registration_player (tournament_id, player_id),
  UNIQUE KEY uq_registration_identity (entrant_id, player_id),
  KEY ix_registration_history (player_id, tournament_id),
  CONSTRAINT fk_registration_entrant FOREIGN KEY (entrant_id, tournament_id) REFERENCES tournament_entrant (entrant_id, tournament_id),
  CONSTRAINT fk_registration_player FOREIGN KEY (player_id) REFERENCES player (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_round (
  round_id VARCHAR(36) PRIMARY KEY,
  tournament_id VARCHAR(36) NOT NULL,
  round_number SMALLINT UNSIGNED NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SCHEDULED',
  scheduled_start_at DATETIME(3) NOT NULL,
  hard_deadline_at DATETIME(3) NOT NULL,
  pairings_published_at DATETIME(3) NULL,
  actual_started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  pairing_algorithm_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  pairing_input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  pairing_input_version BIGINT UNSIGNED NULL,
  failure_code VARCHAR(64) NULL,
  failure_details JSON NULL,
  lock_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_round_number (tournament_id, round_number),
  UNIQUE KEY uq_round_scope (round_id, tournament_id),
  KEY ix_round_due (status, scheduled_start_at),
  CONSTRAINT fk_round_tournament FOREIGN KEY (tournament_id) REFERENCES tournament (tournament_id),
  CONSTRAINT ck_round_number CHECK (round_number > 0),
  CONSTRAINT ck_round_times CHECK (hard_deadline_at > scheduled_start_at),
  CONSTRAINT ck_round_status CHECK (status IN ('SCHEDULED','PAIRED','IN_PROGRESS','COMPLETED','FAILED','CANCELLED')),
  CONSTRAINT ck_round_completion CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_round_allocation (
  allocation_id VARCHAR(36) PRIMARY KEY,
  tournament_id VARCHAR(36) NOT NULL,
  round_id VARCHAR(36) NOT NULL,
  entrant_id VARCHAR(36) NOT NULL,
  allocation_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resolution_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  awarded_points DECIMAL(4,2) NULL,
  award_reason VARCHAR(64) NULL,
  resolved_at DATETIME(3) NULL,
  pairing_bye_round_id VARCHAR(36) GENERATED ALWAYS AS (CASE WHEN allocation_type='PAIRING_BYE' THEN round_id ELSE NULL END) STORED,
  pairing_bye_entrant_id VARCHAR(36) GENERATED ALWAYS AS (CASE WHEN allocation_type='PAIRING_BYE' THEN entrant_id ELSE NULL END) STORED,
  UNIQUE KEY uq_allocation_round (round_id, entrant_id),
  UNIQUE KEY uq_allocation_single_bye (pairing_bye_round_id),
  UNIQUE KEY uq_allocation_no_repeat_bye (pairing_bye_entrant_id),
  UNIQUE KEY uq_allocation_scope (allocation_id, tournament_id, round_id, entrant_id, allocation_type),
  CONSTRAINT fk_allocation_round FOREIGN KEY (round_id, tournament_id) REFERENCES tournament_round (round_id, tournament_id),
  CONSTRAINT fk_allocation_entrant FOREIGN KEY (entrant_id, tournament_id) REFERENCES tournament_entrant (entrant_id, tournament_id),
  CONSTRAINT ck_allocation_type CHECK (allocation_type IN ('MATCH','PAIRING_BYE','REQUESTED_BYE','WITHDRAWN')),
  CONSTRAINT ck_allocation_points CHECK ((allocation_type = 'MATCH' AND awarded_points IS NULL) OR (awarded_points IS NOT NULL AND ((allocation_type = 'PAIRING_BYE' AND awarded_points = 1) OR (allocation_type = 'REQUESTED_BYE' AND awarded_points IN (0,0.5)) OR (allocation_type = 'WITHDRAWN' AND awarded_points = 0)))),
  CONSTRAINT ck_allocation_resolution CHECK ((resolution_status = 'PENDING' AND resolved_at IS NULL) OR (resolution_status = 'RESOLVED' AND resolved_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_match (
  match_id VARCHAR(36) PRIMARY KEY,
  tournament_id VARCHAR(36) NOT NULL,
  round_id VARCHAR(36) NOT NULL,
  board_number INT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  actual_started_at DATETIME(3) NULL,
  finalized_at DATETIME(3) NULL,
  lock_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_match_board (round_id, board_number),
  UNIQUE KEY uq_match_tournament (match_id, tournament_id),
  UNIQUE KEY uq_match_scope (match_id, tournament_id, round_id),
  KEY ix_match_round_state (round_id, status, board_number),
  CONSTRAINT fk_match_round FOREIGN KEY (round_id, tournament_id) REFERENCES tournament_round (round_id, tournament_id),
  CONSTRAINT ck_match_board CHECK (board_number > 0),
  CONSTRAINT ck_match_state CHECK (status IN ('DRAFT','WAITING','IN_PROGRESS','FINALIZED')),
  CONSTRAINT ck_match_finalized CHECK ((status = 'FINALIZED' AND finalized_at IS NOT NULL) OR (status <> 'FINALIZED' AND finalized_at IS NULL)),
  CONSTRAINT ck_match_playing CHECK (status <> 'IN_PROGRESS' OR actual_started_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_match_slot (
  slot_id VARCHAR(36) PRIMARY KEY,
  match_id VARCHAR(36) NOT NULL,
  tournament_id VARCHAR(36) NOT NULL,
  round_id VARCHAR(36) NOT NULL,
  allocation_id VARCHAR(36) NOT NULL,
  entrant_id VARCHAR(36) NOT NULL,
  allocation_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MATCH',
  color VARCHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UNIQUE KEY uq_slot_color (match_id, color),
  UNIQUE KEY uq_slot_allocation (allocation_id),
  UNIQUE KEY uq_slot_entrant (match_id, entrant_id),
  UNIQUE KEY uq_slot_identity (slot_id, match_id, entrant_id, color),
  CONSTRAINT fk_slot_match FOREIGN KEY (match_id, tournament_id, round_id) REFERENCES tournament_match (match_id, tournament_id, round_id),
  CONSTRAINT fk_slot_allocation FOREIGN KEY (allocation_id, tournament_id, round_id, entrant_id, allocation_type) REFERENCES tournament_round_allocation (allocation_id, tournament_id, round_id, entrant_id, allocation_type),
  CONSTRAINT ck_slot_match_only CHECK (allocation_type = 'MATCH'),
  CONSTRAINT ck_slot_color CHECK (color IN ('WHITE','BLACK'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tournament_opponent_pair (
  tournament_id VARCHAR(36) NOT NULL,
  lower_entrant_id VARCHAR(36) NOT NULL,
  higher_entrant_id VARCHAR(36) NOT NULL,
  match_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (tournament_id, lower_entrant_id, higher_entrant_id),
  UNIQUE KEY uq_pair_match (match_id),
  CONSTRAINT fk_pair_match FOREIGN KEY (match_id, tournament_id) REFERENCES tournament_match (match_id, tournament_id),
  CONSTRAINT fk_pair_lower FOREIGN KEY (match_id, lower_entrant_id) REFERENCES tournament_match_slot (match_id, entrant_id),
  CONSTRAINT fk_pair_higher FOREIGN KEY (match_id, higher_entrant_id) REFERENCES tournament_match_slot (match_id, entrant_id),
  CONSTRAINT ck_pair_order CHECK (lower_entrant_id < higher_entrant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
