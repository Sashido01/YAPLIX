import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Fault, parseEvent, uuid } from './contracts.ts';
import type { GameEvent } from './contracts.ts';
import type { Store } from './store.ts';
import { arenaDeclared } from './arena-contract.ts';

export const ARENA_TTL = 2 * 3600_000;
export const ATTEMPT_TTL = 10 * 60_000;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
type Room = { room_id: string; version_id: string; sha256: string; state: 'open'|'closed'; expires_at: number; created_at: number };
type Player = { player_id: string; room_id: string; nickname: string; best_score: number|null };

/** All room/player/game bindings are resolved server-side, never supplied as score fields. */
export class ArenaStore {
  private store: Store;
  constructor(store: Store) { this.store = store; }
  room(id: string): Room {
    const row = this.store.db.prepare('SELECT * FROM arena_rooms WHERE room_id=?').get(uuid(id));
    if (!row) throw new Fault('ARENA_NOT_FOUND', 404);
    return row as Room;
  }
  private open(id: string) {
    const room = this.room(id);
    if (room.state !== 'open' || room.expires_at <= Date.now()) throw new Fault('ARENA_CLOSED', 409);
    const version = this.store.getVersion(room.version_id);
    if (hash(version.html) !== room.sha256) throw new Fault('ARENA_VERSION_CHANGED', 409);
    return room;
  }
  rooms(versionId: string) {
    this.store.getVersion(versionId);
    return this.store.db.prepare('SELECT room_id FROM arena_rooms WHERE version_id=? ORDER BY created_at DESC LIMIT 100').all(versionId).map(r => this.board(String(r.room_id)));
  }
  create(versionId: string) {
    const version = this.store.getVersion(versionId);
    if (!arenaDeclared(version.html)) throw new Fault('ARENA_UNSUPPORTED', 409);
    return this.store.transaction(() => {
      if (Number(this.store.db.prepare('SELECT COUNT(*) n FROM arena_rooms').get()?.n) >= 100) throw new Fault('ARENA_ROOM_QUOTA', 507);
      const id = randomUUID(), now = Date.now();
      this.store.db.prepare('INSERT INTO arena_rooms VALUES (?,?,?,?,?,?)').run(id, versionId, hash(version.html), 'open', now + ARENA_TTL, now);
      return this.board(id);
    });
  }
  resume(id: string, versionId: string) {
    const r = this.room(id);
    if (r.version_id !== uuid(versionId)) throw new Fault('ARENA_VERSION_MISMATCH', 409);
    const v = this.store.getVersion(r.version_id);
    if (!arenaDeclared(v.html) || hash(v.html) !== r.sha256) throw new Fault('ARENA_VERSION_CHANGED', 409);
    // A fresh listener never inherits an unfinished attempt from an earlier admission.
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE arena_attempts SET state='abandoned' WHERE room_id=? AND state='playing'").run(id);
      this.store.db.prepare("UPDATE arena_rooms SET state='open',expires_at=? WHERE room_id=?").run(Date.now() + ARENA_TTL, id);
    });
    return this.board(id);
  }
  close(id: string) {
    this.room(id);
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE arena_rooms SET state='closed' WHERE room_id=?").run(id);
      this.store.db.prepare("UPDATE arena_attempts SET state='abandoned' WHERE room_id=? AND state='playing'").run(id);
    });
    return this.board(id);
  }
  join(id: string, input: unknown) {
    this.open(id);
    if (typeof input !== 'string') throw new Fault('ARENA_NICKNAME');
    const nickname = input.normalize('NFKC').trim().replace(/ +/g, ' ');
    if (nickname.length < 2 || nickname.length > 24 || !/^[\p{L}\p{N} _.-]+$/u.test(nickname)) throw new Fault('ARENA_NICKNAME');
    const key = nickname.toLowerCase();
    return this.store.transaction(() => {
      const db = this.store.db;
      if (db.prepare('SELECT 1 FROM arena_players WHERE room_id=? AND name_key=?').get(id,key)) throw new Fault('ARENA_NICKNAME_TAKEN',409);
      if (Number(db.prepare('SELECT COUNT(*) n FROM arena_players WHERE room_id=?').get(id)?.n) >= 100) throw new Fault('ARENA_PLAYER_QUOTA',507);
      const playerId = randomUUID(), token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO arena_players VALUES (?,?,?,?,?,NULL,NULL,?)').run(playerId,id,nickname,key,hash(token),Date.now());
      return { playerId, nickname, token };
    });
  }
  player(id: string, token: string): Player {
    const p = this.store.db.prepare('SELECT player_id,room_id,nickname,best_score FROM arena_players WHERE room_id=? AND token_hash=?').get(uuid(id),hash(token));
    if (!p) throw new Fault('ARENA_ACCESS_REQUIRED',401);
    return p as Player;
  }
  start(id: string, token: string) {
    const r = this.open(id), p = this.player(id,token), db = this.store.db;
    const last = db.prepare('SELECT created_at FROM arena_attempts WHERE player_id=? ORDER BY created_at DESC LIMIT 1').get(p.player_id);
    if (last && Date.now() - Number(last.created_at) < 1000) throw new Fault('ARENA_ATTEMPT_RATE',429);
    if (Number(db.prepare('SELECT COUNT(*) n FROM arena_attempts').get()?.n) >= 10_000) throw new Fault('ARENA_ATTEMPT_QUOTA',507);
    const session = this.store.session(r.version_id, sessionId => {
      db.prepare("UPDATE arena_attempts SET state='abandoned' WHERE player_id=? AND state='playing'").run(p.player_id);
      db.prepare('UPDATE sessions SET expires_at=? WHERE session_id=?').run(Math.min(r.expires_at,Date.now()+ATTEMPT_TTL),sessionId);
      db.prepare("INSERT INTO arena_attempts VALUES (?,?,?,'playing',?,NULL,NULL)").run(sessionId,id,p.player_id,Date.now());
    });
    return { ...session, expiresAt: Math.min(r.expires_at,Date.now()+ATTEMPT_TTL), sha256:r.sha256 };
  }
  event(id: string, cookie: string, token: string, input: unknown) {
    const r = this.open(id), p = this.player(id,cookie), e = parseEvent(input), db = this.store.db;
    const a = db.prepare('SELECT * FROM arena_attempts WHERE session_id=? AND room_id=? AND player_id=?').get(e.sessionId,id,p.player_id);
    if (!a || e.versionId !== r.version_id) throw new Fault('ARENA_ATTEMPT_MISMATCH',409);
    const previous = db.prepare('SELECT payload FROM events WHERE event_id=? AND session_id=?').get(e.eventId,e.sessionId);
    if (previous) return this.store.event(e,token); // Exact retries only; conflicting payload still fails.
    if (a.state !== 'playing') throw new Fault('ARENA_ATTEMPT_ENDED',409);
    const s = db.prepare('SELECT * FROM sessions WHERE session_id=?').get(e.sessionId)!;
    if (e.sequence === 0 && e.type !== 'game_ready' || e.type === 'game_ready' && e.sequence !== 0 || e.type === 'game_started' && e.sequence !== 1) throw new Fault('ARENA_EVENT_STATE',409);
    if (e.type === 'score_changed' && (!Number.isSafeInteger(e.data.score) || e.data.score! < 0)) throw new Fault('INVALID_SCORE');
    if (e.type === 'session_ended' && (s.score === null || s.started_at === null)) throw new Fault('ARENA_SCORE_MISSING',409);
    return this.store.event(e as GameEvent,token,() => {
      if (e.type === 'game_error') db.prepare("UPDATE arena_attempts SET state='abandoned' WHERE session_id=?").run(e.sessionId);
      if (e.type !== 'session_ended') return;
      db.prepare("UPDATE arena_attempts SET state='completed',completed_at=?,score=? WHERE session_id=?").run(Date.now(),s.score,e.sessionId);
      db.prepare('UPDATE arena_players SET best_score=?,best_at=? WHERE player_id=? AND (best_score IS NULL OR best_score<?)').run(s.score,Date.now(),p.player_id,s.score);
    });
  }
  board(id: string) {
    const r = this.room(id);
    const rows = this.store.db.prepare('SELECT nickname,best_score,best_at FROM arena_players WHERE room_id=? ORDER BY best_score DESC,best_at,player_id').all(id);
    let rank = 0, last: unknown = null;
    return { roomId:r.room_id, versionId:r.version_id, sha256:r.sha256, state:r.state, expiresAt:r.expires_at, open:r.state==='open'&&r.expires_at>Date.now(), trust:'client_game_events' as const,
      players:rows.map((p,i) => { if (p.best_score !== null && p.best_score !== last) rank=i+1; last=p.best_score; return { place:p.best_score===null?null:rank, nickname:String(p.nickname), bestScore:p.best_score as number|null }; }) };
  }
}
