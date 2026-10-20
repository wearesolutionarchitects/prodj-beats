import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LightingLookup, CachedBank } from '../application/cached-event-source';

const TABLES = {
  user: ['content', 'phrase_data', 'lighting_data'],
  macros: ['macro', 'macro_pattern', 'macro_assign', 'macro_fixture', 'macro_data', 'macro_event']
} as const;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Private local cache. Sources are opened read-only; no player-ID based matching. */
export class LightingDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string, readOnly = false) {
    this.db = new DatabaseSync(path, { readOnly });
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('Unsupported lighting database schema'); }
    if (version === 1) {
      if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_snapshot'").get()) {
        this.db.close(); throw new Error('Target is not a ProDJ lighting cache');
      }
      return;
    }
    if (readOnly) { this.db.close(); throw new Error('Cache is not initialized'); }
    if (version === 0 && Number(this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()!.n) > 0) {
      this.db.close(); throw new Error('Target is not an empty ProDJ lighting cache');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_snapshot (
        role TEXT PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL, imported_at TEXT NOT NULL, source_version TEXT
      );
      CREATE TABLE IF NOT EXISTS track_identity (
        master_db_id INTEGER NOT NULL, song_id INTEGER NOT NULL,
        title TEXT NOT NULL, artist TEXT NOT NULL, duration_ms INTEGER NOT NULL,
        phrase_sha256 TEXT NOT NULL, evidence TEXT NOT NULL,
        PRIMARY KEY(master_db_id,song_id)
      );
      PRAGMA user_version=1;
    `);
  }

  importSnapshots(paths: { user: string; macros: string }): { changed: boolean; tracks: number; macros: number } {
    const sources: DatabaseSync[] = [];
    let transaction = false;
    try {
      const snapshots = (Object.keys(TABLES) as (keyof typeof TABLES)[]).map(role => {
        const path = resolve(paths[role]);
        // Require stable snapshots rather than silently ignoring uncheckpointed changes.
        for (const suffix of ['-wal', '-journal']) if (existsSync(path + suffix) && statSync(path + suffix).size > 0) {
          throw new Error('Import requires a consistent source snapshot without an active WAL/journal');
        }
        const hash = digest(path);
        const source = new DatabaseSync(path, { readOnly: true }); sources.push(source);
        source.exec('PRAGMA query_only=ON; BEGIN;');
        if (source.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new Error('Invalid source database');
        return { role, path, hash, source };
      });
      const changed = snapshots.some(s => this.db.prepare('SELECT sha256 FROM source_snapshot WHERE role=?').get(s.role)?.sha256 !== s.hash);
      if (!changed) return { changed: false, ...this.counts() };
      this.db.exec('BEGIN IMMEDIATE'); transaction = true;
      for (const { role, source, path, hash } of snapshots) {
        for (const table of TABLES[role]) {
          const columns = source.prepare(`PRAGMA table_info(${quote(table)})`).all();
          if (!columns.length) throw new Error(`Missing source table: ${table}`);
          const definitions = columns.map(column => {
            const type = String(column.type).toUpperCase();
            if (!/^(INTEGER|TEXT|REAL|BLOB|NUMERIC|VARCHAR\(\d+\))$/.test(type)) throw new Error('Unsupported source column type');
            return `${quote(String(column.name))} ${type}`;
          });
          const target = quote(`rb_${table}`);
          this.db.exec(`DROP TABLE IF EXISTS ${target}; CREATE TABLE ${target} (${definitions.join(',')})`);
          const names = columns.map(column => String(column.name));
          const insert = this.db.prepare(`INSERT INTO ${target} VALUES (${names.map(() => '?').join(',')})`);
          for (const row of source.prepare(`SELECT * FROM ${quote(table)}`).iterate()) {
            insert.run(...names.map(name => row[name] as SQLInputValue));
          }
        }
        if (digest(path) !== hash) throw new Error('Source changed during import');
        const hasVersion = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lighting_property'").get();
        const version = hasVersion ? source.prepare("SELECT value FROM lighting_property WHERE key='DbVersionNum'").get()?.value : null;
        this.db.prepare('INSERT OR REPLACE INTO source_snapshot VALUES (?,?,?,?,?,?)')
          .run(role, path, hash, statSync(path).size, new Date().toISOString(), version == null ? null : String(version));
      }
      this.db.exec(`CREATE INDEX rb_content_identity ON rb_content(master_db_id,song_id);
        CREATE INDEX rb_phrases_content ON rb_phrase_data(content_id);
        CREATE INDEX rb_macro_ids ON rb_macro(id);
        CREATE INDEX rb_macro_data_ids ON rb_macro_data(macro_id);
        CREATE INDEX rb_macro_events ON rb_macro_event(macro_data_id);`);
      this.db.exec('COMMIT'); transaction = false;
      return { changed: true, ...this.counts() };
    } catch (error) {
      if (transaction) this.db.exec('ROLLBACK');
      throw error;
    } finally { sources.forEach(source => source.close()); }
  }

  /** A confirmed local library identity, never an XDJ player/slot ID. */
  lookup(masterDbId: number, songId: number) {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rb_content'").get()) return null;
    const rows = this.db.prepare(`SELECT c.id AS contentId,c.macro_pattern_id AS macroPatternId,
      p.energy,p.pattern FROM rb_content c LEFT JOIN rb_macro_pattern p ON p.id=c.macro_pattern_id
      WHERE c.master_db_id=? AND c.song_id=?`).all(masterDbId, songId);
    if (rows.length !== 1) return null; // Missing or ambiguous means unknown.
    const row = rows[0]!;
    const phrases = this.db.prepare(`SELECT p.phrase_num AS phrase,p.macro_id AS macroId,
      p.initial_macro_id AS initialMacroId,m.name FROM rb_phrase_data p
      LEFT JOIN rb_macro m ON m.id=p.macro_id WHERE p.content_id=? ORDER BY p.phrase_num`).all(row.contentId!);
    const banks: Record<number, string> = { 1: 'cool', 2: 'natural', 3: 'hot', 4: 'subtle', 5: 'warm', 6: 'vivid', 7: 'club-1', 8: 'club-2' };
    return { contentId: row.contentId, macroPatternId: row.macroPatternId, energy: row.energy,
      pattern: row.pattern, bank: banks[Number(row.pattern)] ?? null, phrases };
  }

  /** Exact, previously verified library mapping. Never infer library IDs from player IDs. */
  resolveBank(identity: LightingLookup): CachedBank | null {
    if (!identity.phrases.length) return null;
    const hash = createHash('sha256').update(JSON.stringify(identity.phrases)).digest('hex');
    const matches = this.db.prepare(`SELECT master_db_id,song_id FROM track_identity
      WHERE title=? AND artist=? AND duration_ms=? AND phrase_sha256=?`)
      .all(identity.title, identity.artist, identity.durationMs, hash);
    if (matches.length !== 1) return null;
    const match = matches[0]!;
    const value = this.lookup(Number(match.master_db_id), Number(match.song_id));
    const snapshot = this.db.prepare("SELECT sha256 FROM source_snapshot WHERE role='user'").get();
    const macros = this.db.prepare("SELECT sha256 FROM source_snapshot WHERE role='macros'").get();
    if (!value?.bank || !snapshot || !macros) return null;
    return { bank: value.bank as CachedBank['bank'], origin: 'sqlite',
      masterDbId: Number(match.master_db_id), songId: Number(match.song_id),
      snapshotSha256: String(snapshot.sha256), macroSnapshotSha256: String(macros.sha256) };
  }

  saveIdentity(identity: { masterDbId: number; songId: number; title: string; artist: string; durationMs: number; phraseSha256: string; evidence: string }) {
    if (!this.lookup(identity.masterDbId, identity.songId)) throw new Error('Unknown or ambiguous local lighting identity');
    this.db.prepare('INSERT OR REPLACE INTO track_identity VALUES (?,?,?,?,?,?,?)').run(identity.masterDbId,
      identity.songId, identity.title, identity.artist, identity.durationMs, identity.phraseSha256, identity.evidence);
  }

  /** Replace only generated mappings atomically; retain independently confirmed evidence. */
  syncLibraryIdentities(identities: Parameters<LightingDatabase['saveIdentity']>[0][]): boolean {
    const method = 'rekordbox-library-anlz-v1';
    const generated = "CASE WHEN json_valid(evidence) THEN json_extract(evidence,'$.method') END = ?";
    const tuples = identities.map(i => [i.masterDbId, i.songId, i.title, i.artist, i.durationMs, i.phraseSha256, i.evidence]);
    tuples.sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));
    const previous = this.db.prepare(`SELECT * FROM track_identity WHERE ${generated}
      ORDER BY master_db_id,song_id`).all(method).map(row => Object.values(row));
    if (JSON.stringify(tuples) === JSON.stringify(previous)) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`DELETE FROM track_identity WHERE ${generated}`).run(method);
      for (const identity of identities) this.saveIdentity(identity);
      this.db.exec('COMMIT');
      return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private counts() {
    return { tracks: Number(this.db.prepare('SELECT count(*) AS n FROM rb_content').get()!.n),
      macros: Number(this.db.prepare('SELECT count(*) AS n FROM rb_macro').get()!.n) };
  }
  close() { this.db.close(); }
}
