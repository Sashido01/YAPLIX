// Additive migration only. Existing versions, jobs, sessions and events stay intact.
export const SCHEMA_V3 = [
  "CREATE TABLE arena_rooms(room_id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES versions(version_id), sha256 TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','closed')), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL) STRICT",
  'CREATE INDEX arena_rooms_version ON arena_rooms(version_id,created_at)',
  'CREATE TABLE arena_players(player_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES arena_rooms(room_id), nickname TEXT NOT NULL, name_key TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, best_score REAL, best_at INTEGER, joined_at INTEGER NOT NULL, UNIQUE(room_id,name_key)) STRICT',
  "CREATE TABLE arena_attempts(session_id TEXT PRIMARY KEY REFERENCES sessions(session_id), room_id TEXT NOT NULL REFERENCES arena_rooms(room_id), player_id TEXT NOT NULL REFERENCES arena_players(player_id), state TEXT NOT NULL CHECK(state IN ('playing','completed','abandoned')), created_at INTEGER NOT NULL, completed_at INTEGER, score REAL) STRICT",
  'CREATE INDEX arena_attempts_player ON arena_attempts(player_id,created_at)',
];
