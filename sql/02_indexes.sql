CREATE INDEX ix_players_team           ON players (team_id);

CREATE INDEX ix_matches_tournament_dt  ON matches (tournament_id, scheduled_at DESC);
CREATE INDEX ix_matches_sport_status   ON matches (sport_id, status);
CREATE INDEX ix_matches_home_team      ON matches (home_team_id);
CREATE INDEX ix_matches_away_team      ON matches (away_team_id);

CREATE INDEX ix_match_periods_match    ON match_periods (match_id, period_number);
CREATE INDEX ix_match_period_stats_per ON match_period_stats (period_id, team_id);
CREATE INDEX ix_match_period_stats_kv  ON match_period_stats (stat_key, stat_value);

CREATE INDEX ix_match_lineups_match    ON match_lineups (match_id, team_id);
CREATE INDEX ix_match_lineups_player   ON match_lineups (player_id);

CREATE INDEX ix_match_events_match     ON match_events (match_id, period_number, minute);
CREATE INDEX ix_match_events_player    ON match_events (player_id, event_type);
CREATE INDEX ix_match_events_type      ON match_events (event_type);

ANALYZE;
