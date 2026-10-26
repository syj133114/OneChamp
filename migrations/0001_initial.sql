PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS candidates (
  puuid TEXT PRIMARY KEY, source TEXT NOT NULL, discovered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  puuid TEXT PRIMARY KEY, riot_name TEXT NOT NULL, riot_tag TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS champion_stats (
  puuid TEXT NOT NULL REFERENCES snapshots(puuid) ON DELETE CASCADE,
  champion_id TEXT NOT NULL, pick_rate REAL NOT NULL, champion_games INTEGER NOT NULL,
  win_rate REAL NOT NULL, mastery_points INTEGER, rank_order INTEGER NOT NULL,
  recognition TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(puuid, champion_id)
);
CREATE INDEX IF NOT EXISTS stats_champion_pick ON champion_stats(champion_id, pick_rate DESC);
CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, subject TEXT NOT NULL, status TEXT NOT NULL,
  phase TEXT NOT NULL, payload TEXT NOT NULL, error_code TEXT, error_message TEXT,
  retry_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_subject ON jobs(subject) WHERE status='running';
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, updated_at);
CREATE TABLE IF NOT EXISTS riot_gate (
  id INTEGER PRIMARY KEY CHECK(id=1), next_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO riot_gate(id) VALUES (1);
CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY, tier TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
