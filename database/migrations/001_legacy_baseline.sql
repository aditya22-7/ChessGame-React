-- Schema-only baseline from the supplied MySQL 8.0.36 game_* dumps.
-- No source data, DROP statements, or disabled foreign-key checks.

CREATE TABLE `player` (
  `player_id` varchar(36) NOT NULL,
  `first_name` varchar(25) NOT NULL,
  `last_name` varchar(25) NOT NULL,
  `username` varchar(25) NOT NULL,
  `_password` varchar(15) NOT NULL,
  PRIMARY KEY (`player_id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_accesslog` (
  `player_accesslog_id` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  `login_time` datetime DEFAULT NULL,
  PRIMARY KEY (`player_accesslog_id`),
  KEY `fk_player_accesslog_idx` (`playerID`),
  CONSTRAINT `fk_player_accesslog` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_affiliation` (
  `player_affiliation_id` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  `country` varchar(25) NOT NULL,
  `_organization` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`player_affiliation_id`),
  UNIQUE KEY `playerID_UNIQUE` (`playerID`),
  KEY `fk_player_affiliation_idx` (`playerID`),
  CONSTRAINT `fk_player_affiliation` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_contact` (
  `player_contact_id` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  `mobile_number` varchar(20) NOT NULL,
  `email` varchar(50) NOT NULL,
  PRIMARY KEY (`player_contact_id`),
  UNIQUE KEY `mobile_number` (`mobile_number`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `playerID_UNIQUE` (`playerID`),
  KEY `fk_player_contact_idx` (`playerID`),
  CONSTRAINT `fk_player_contact` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_gametheme` (
  `player_gametheme_id` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  `game_theme_mode` varchar(15) DEFAULT NULL,
  PRIMARY KEY (`player_gametheme_id`),
  UNIQUE KEY `playerID_UNIQUE` (`playerID`),
  KEY `fk_player_gametheme_idx` (`playerID`),
  CONSTRAINT `fk_player_gametheme` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_history` (
  `player_history_id` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  `matches_played` int NOT NULL,
  `tournaments_played` int NOT NULL,
  PRIMARY KEY (`player_history_id`),
  UNIQUE KEY `playerID_UNIQUE` (`playerID`),
  KEY `fk_player_history_idx` (`playerID`),
  CONSTRAINT `fk_player_history` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_subscription` (
  `player_subscription_id` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  `game_subscription` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`player_subscription_id`),
  UNIQUE KEY `playerID_UNIQUE` (`playerID`),
  KEY `fk_player_subscription_idx` (`playerID`),
  CONSTRAINT `fk_player_subscription` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_uitheme` (
  `player_uitheme_id` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  `theme_mode` varchar(30) NOT NULL,
  PRIMARY KEY (`player_uitheme_id`),
  UNIQUE KEY `playerID_UNIQUE` (`playerID`),
  KEY `fk_player_uitheme_idx` (`playerID`),
  CONSTRAINT `fk_player_uitheme` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `ruleset` (
  `ruleset_id` varchar(36) NOT NULL,
  `formation_date` datetime NOT NULL,
  `description` varchar(200) NOT NULL,
  PRIMARY KEY (`ruleset_id`),
  UNIQUE KEY `unique_columns_ruleset` (`formation_date`,`description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tourtype` (
  `tourType_id` varchar(36) NOT NULL,
  `_name` varchar(25) NOT NULL,
  `_description` varchar(75) NOT NULL,
  PRIMARY KEY (`tourType_id`),
  UNIQUE KEY `unique_columns_tourtype` (`_name`,`_description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tournament` (
  `tournament_id` varchar(36) NOT NULL,
  `tourtypeID` varchar(36) NOT NULL,
  `tour_name` varchar(50) NOT NULL,
  `tour_version` decimal(5,2) NOT NULL,
  `number_of_teams` int NOT NULL,
  `number_of_players` int NOT NULL,
  `tour_start_day` datetime DEFAULT NULL,
  `tour_end_day` datetime DEFAULT NULL,
  PRIMARY KEY (`tournament_id`),
  UNIQUE KEY `tour_name` (`tour_name`,`tour_version`),
  KEY `fk_tournament_tourtype_idx` (`tourtypeID`),
  CONSTRAINT `fk_tournament_tourtype` FOREIGN KEY (`tourtypeID`) REFERENCES `tourtype` (`tourType_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `teams` (
  `team_id` varchar(36) NOT NULL,
  `unique_name` varchar(25) NOT NULL,
  `team_name` varchar(25) NOT NULL,
  `number_of_players` int NOT NULL,
  PRIMARY KEY (`team_id`),
  UNIQUE KEY `unique_name` (`unique_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team_criteria` (
  `team_criteria_id` varchar(36) NOT NULL,
  `teamID` varchar(36) NOT NULL,
  `minimum_ranking` int NOT NULL,
  `maximum_ranking` int DEFAULT NULL,
  `minimum_players_number` int DEFAULT NULL,
  `maximum_players_number` int DEFAULT NULL,
  PRIMARY KEY (`team_criteria_id`),
  UNIQUE KEY `teamID_UNIQUE` (`teamID`),
  KEY `fk_team_criteria_idx` (`teamID`),
  CONSTRAINT `fk_team_criteria` FOREIGN KEY (`teamID`) REFERENCES `teams` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team_history` (
  `team_history_id` varchar(36) NOT NULL,
  `teamID` varchar(36) NOT NULL,
  `number_of_tournaments` int DEFAULT NULL,
  PRIMARY KEY (`team_history_id`),
  UNIQUE KEY `teamID_UNIQUE` (`teamID`),
  KEY `fk_team_history_idx` (`teamID`),
  CONSTRAINT `fk_team_history` FOREIGN KEY (`teamID`) REFERENCES `teams` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `teamstate` (
  `teamState_id` varchar(36) NOT NULL,
  `teamsID` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  PRIMARY KEY (`teamState_id`),
  UNIQUE KEY `unique_columns_teamstate` (`teamsID`,`playerID`),
  KEY `fk_teamState_player_idx` (`playerID`),
  KEY `fk_teamState_teams_idx` (`teamsID`),
  CONSTRAINT `fk_teamState_player` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`),
  CONSTRAINT `fk_teamState_teams` FOREIGN KEY (`teamsID`) REFERENCES `teams` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tourteams` (
  `TourTeams_id` varchar(36) NOT NULL,
  `tourID` varchar(36) NOT NULL,
  `teamID` varchar(36) NOT NULL,
  PRIMARY KEY (`TourTeams_id`),
  UNIQUE KEY `unique_columns_tourteams` (`tourID`,`teamID`),
  KEY `fk_tournament_tourteams_idx` (`tourID`),
  KEY `fk_tourteams_teams_idx` (`teamID`),
  CONSTRAINT `fk_tournament_tourteams` FOREIGN KEY (`tourID`) REFERENCES `tournament` (`tournament_id`),
  CONSTRAINT `fk_tourteams_teams` FOREIGN KEY (`teamID`) REFERENCES `teams` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tourteamstate` (
  `TourTeamState_id` varchar(36) NOT NULL,
  `tourteamID` varchar(36) NOT NULL,
  `playerID` varchar(36) NOT NULL,
  PRIMARY KEY (`TourTeamState_id`),
  UNIQUE KEY `unique_columns_tourteamsstate` (`tourteamID`,`playerID`),
  KEY `fk_tourteamstate_player_idx` (`playerID`),
  KEY `fk_tourteamstate_teams_idx` (`tourteamID`),
  CONSTRAINT `fk_tourteamstate_player` FOREIGN KEY (`playerID`) REFERENCES `player` (`player_id`),
  CONSTRAINT `fk_tourteamstate_teams` FOREIGN KEY (`tourteamID`) REFERENCES `tourteams` (`TourTeams_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tournament_rules` (
  `tournament_rules_id` varchar(36) NOT NULL,
  `rulesetID` varchar(36) NOT NULL,
  `rule_consideration_date` datetime NOT NULL,
  PRIMARY KEY (`tournament_rules_id`),
  UNIQUE KEY `rulesetID_UNIQUE` (`rulesetID`),
  KEY `fk_tourrules_ruleset_idx` (`rulesetID`),
  CONSTRAINT `fk_tourrules_ruleset` FOREIGN KEY (`rulesetID`) REFERENCES `ruleset` (`ruleset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `this_tournament_rules` (
  `this_tournament_rules_id` varchar(36) NOT NULL,
  `tournamentID` varchar(36) NOT NULL,
  `tournament_rulesID` varchar(36) NOT NULL,
  PRIMARY KEY (`this_tournament_rules_id`),
  UNIQUE KEY `unique_columns_this_tournament_rules` (`tournamentID`,`tournament_rulesID`),
  KEY `fk_this_tourRules_tour_idx` (`tournamentID`),
  KEY `fk_this_tourRules_tourRules_idx` (`tournament_rulesID`),
  CONSTRAINT `fk_this_tourRules_tour` FOREIGN KEY (`tournamentID`) REFERENCES `tournament` (`tournament_id`),
  CONSTRAINT `fk_this_tourRules_tourRules` FOREIGN KEY (`tournament_rulesID`) REFERENCES `tournament_rules` (`tournament_rules_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tour_criteria` (
  `tour_criteria_id` varchar(36) NOT NULL,
  `tourID` varchar(36) NOT NULL,
  `MinimumRanking` int DEFAULT NULL,
  `MaximumRanking` int DEFAULT NULL,
  PRIMARY KEY (`tour_criteria_id`),
  UNIQUE KEY `tourID_UNIQUE` (`tourID`),
  KEY `fk_tour_criteria_idx` (`tourID`),
  CONSTRAINT `fk_tour_criteria` FOREIGN KEY (`tourID`) REFERENCES `tournament` (`tournament_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tourteam_matches` (
  `TourTeamMatches_id` varchar(36) NOT NULL,
  `tourID` varchar(36) NOT NULL,
  `tourteam1` varchar(36) NOT NULL,
  `tourteam2` varchar(36) NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  PRIMARY KEY (`TourTeamMatches_id`),
  KEY `fk_ttm_tourteams_idx` (`tourteam1`),
  KEY `fk_ttm_tourteams2_idx` (`tourteam2`),
  KEY `fk_ttm_tournament_idx` (`tourID`),
  CONSTRAINT `fk_ttm_tournament` FOREIGN KEY (`tourID`) REFERENCES `tournament` (`tournament_id`),
  CONSTRAINT `fk_ttm_tourteams1` FOREIGN KEY (`tourteam1`) REFERENCES `tourteams` (`TourTeams_id`),
  CONSTRAINT `fk_ttm_tourteams2` FOREIGN KEY (`tourteam2`) REFERENCES `tourteams` (`TourTeams_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tourteam_player_matches` (
  `tourteam_player_matches_id` varchar(36) NOT NULL,
  `tourteam_matchID` varchar(36) NOT NULL,
  `player1` varchar(36) NOT NULL,
  `player2` varchar(36) NOT NULL,
  `start_time` varchar(36) NOT NULL,
  `time_period` int NOT NULL,
  PRIMARY KEY (`tourteam_player_matches_id`),
  KEY `fk_ttpm_ttm_idx` (`tourteam_matchID`),
  KEY `fk_ttpm_ttstate_idx` (`player1`),
  KEY `fk_ttpm_ttstate2_idx` (`player2`),
  CONSTRAINT `fk_ttpm_ttm` FOREIGN KEY (`tourteam_matchID`) REFERENCES `tourteam_matches` (`TourTeamMatches_id`),
  CONSTRAINT `fk_ttpm_ttstate1` FOREIGN KEY (`player1`) REFERENCES `tourteamstate` (`TourTeamState_id`),
  CONSTRAINT `fk_ttpm_ttstate2` FOREIGN KEY (`player2`) REFERENCES `tourteamstate` (`TourTeamState_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tourteam_match_details` (
  `tourteam_match_details_id` varchar(36) NOT NULL,
  `tourteam_matchID` varchar(36) NOT NULL,
  `draw` varchar(10) DEFAULT NULL,
  `winner_team` varchar(36) DEFAULT NULL,
  `losing_team` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`tourteam_match_details_id`),
  UNIQUE KEY `tourteam_matchesID_UNIQUE` (`tourteam_matchID`),
  KEY `fk_ttmd_tourteam1_idx` (`winner_team`),
  KEY `fk_ttmd_tourteam2_idx` (`losing_team`),
  CONSTRAINT `fk_ttmd_tourteam_loss` FOREIGN KEY (`losing_team`) REFERENCES `tourteams` (`TourTeams_id`),
  CONSTRAINT `fk_ttmd_tourteam_win` FOREIGN KEY (`winner_team`) REFERENCES `tourteams` (`TourTeams_id`),
  CONSTRAINT `fk_ttmd_ttm` FOREIGN KEY (`tourteam_matchID`) REFERENCES `tourteam_matches` (`TourTeamMatches_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tourteam_player_match_details` (
  `tourteam_player_match_details_id` varchar(36) NOT NULL,
  `tourteam_player_matchID` varchar(36) NOT NULL,
  `white_pieces_player` varchar(36) NOT NULL,
  `black_pieces_player` varchar(36) NOT NULL,
  `draw` varchar(10) DEFAULT NULL,
  `winning_player` varchar(36) DEFAULT NULL,
  `losing_player` varchar(36) DEFAULT NULL,
  `playing_start_time` datetime NOT NULL,
  `playing_end_time` datetime NOT NULL,
  PRIMARY KEY (`tourteam_player_match_details_id`),
  UNIQUE KEY `tourteam_player_matchID_UNIQUE` (`tourteam_player_matchID`),
  KEY `fk_ttplayer_rmatch_idx` (`tourteam_player_matchID`),
  KEY `fk_ttpmd_tourteamstate1_idx` (`winning_player`),
  KEY `fk_ttpmd_tourteamstate2_idx` (`losing_player`),
  KEY `fk_ttpmd_tourteamstate_white_idx` (`white_pieces_player`),
  KEY `fk_ttpmd_tourteamstate_black_idx` (`black_pieces_player`),
  CONSTRAINT `fk_ttpmd_tourteamstate1` FOREIGN KEY (`winning_player`) REFERENCES `tourteamstate` (`TourTeamState_id`),
  CONSTRAINT `fk_ttpmd_tourteamstate2` FOREIGN KEY (`losing_player`) REFERENCES `tourteamstate` (`TourTeamState_id`),
  CONSTRAINT `fk_ttpmd_tourteamstate_black` FOREIGN KEY (`black_pieces_player`) REFERENCES `tourteamstate` (`TourTeamState_id`),
  CONSTRAINT `fk_ttpmd_tourteamstate_white` FOREIGN KEY (`white_pieces_player`) REFERENCES `tourteamstate` (`TourTeamState_id`),
  CONSTRAINT `fk_ttpmd_ttplayer_match` FOREIGN KEY (`tourteam_player_matchID`) REFERENCES `tourteam_player_matches` (`tourteam_player_matches_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tournament_details` (
  `tournament_details_id` varchar(36) NOT NULL,
  `tourID` varchar(36) NOT NULL,
  `winner_team` varchar(45) NOT NULL,
  PRIMARY KEY (`tournament_details_id`),
  UNIQUE KEY `tourID_UNIQUE` (`tourID`),
  KEY `fk_tourdetails_tournament_idx` (`tourID`),
  KEY `fk_tourdetails_tourteams_idx` (`winner_team`),
  CONSTRAINT `fk_tourdetails_tournament` FOREIGN KEY (`tourID`) REFERENCES `tournament` (`tournament_id`),
  CONSTRAINT `fk_tourdetails_tourteams` FOREIGN KEY (`winner_team`) REFERENCES `tourteams` (`TourTeams_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tournament_match_moves` (
  `tournament_match_moves_id` varchar(36) NOT NULL,
  `ttPlayerMatchesID` varchar(36) NOT NULL,
  `tourTeamStateID` varchar(36) NOT NULL,
  `piece_color` varchar(10) NOT NULL,
  `piece_name` varchar(10) NOT NULL,
  `tile` varchar(7) NOT NULL,
  PRIMARY KEY (`tournament_match_moves_id`),
  KEY `fk_tmm_ttplayer_matches_idx` (`ttPlayerMatchesID`),
  KEY `fk_tmm_tourteamstate_idx` (`tourTeamStateID`),
  CONSTRAINT `fk_tmm_tourteamstate` FOREIGN KEY (`tourTeamStateID`) REFERENCES `tourteamstate` (`TourTeamState_id`),
  CONSTRAINT `fk_tmm_ttplayer_matches` FOREIGN KEY (`ttPlayerMatchesID`) REFERENCES `tourteam_player_matches` (`tourteam_player_matches_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
