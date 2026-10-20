import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LightingDatabase } from './lighting-database';

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'prodj-db-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = { user: join(root, 'user.db3'), macros: join(root, 'macro.db3') };
  const user = new DatabaseSync(paths.user);
  user.exec(`CREATE TABLE content(id INTEGER,song_id INTEGER,master_db_id INTEGER,macro_pattern_id INTEGER);
    CREATE TABLE phrase_data(content_id INTEGER,phrase_num INTEGER,macro_id INTEGER,initial_macro_id INTEGER);
    CREATE TABLE lighting_data(id INTEGER,content_id INTEGER,fixture_id INTEGER,data TEXT);
    CREATE TABLE lighting_property(key TEXT,value TEXT);
    INSERT INTO lighting_property VALUES('DbVersionNum','synthetic-v1');
    INSERT INTO content VALUES(1,123,456,7),(2,123,789,8);
    INSERT INTO phrase_data VALUES(1,1,67,67),(1,2,73,67);
    INSERT INTO lighting_data VALUES(1,1,1,'example');`); user.close();
  const macros = new DatabaseSync(paths.macros);
  macros.exec(`CREATE TABLE macro(id INTEGER,name TEXT);
    CREATE TABLE macro_pattern(id INTEGER,energy INTEGER,pattern INTEGER);
    CREATE TABLE macro_assign(macro_pattern_id INTEGER,phase INTEGER,macro_id INTEGER);
    CREATE TABLE macro_fixture(id INTEGER,name TEXT);
    CREATE TABLE macro_data(id INTEGER,macro_id INTEGER,data TEXT);
    CREATE TABLE macro_event(macro_data_id INTEGER,kind INTEGER,value1 INTEGER);
    INSERT INTO macro VALUES(67,'MID INTRO COOL'),(73,'MID VERSE1 COOL');
    INSERT INTO macro_pattern VALUES(7,2,1),(8,2,2);
    INSERT INTO macro_data VALUES(1,67,'timeline');
    INSERT INTO macro_event VALUES(1,1,255);`); macros.close();
  return { root, paths, target: join(root, 'lighting.sqlite') };
}

test('lighting cache persists complete local assignments and macros across reopen, leaving source bytes unchanged', t => {
  const { paths, target } = setup(t);
  const originals = [readFileSync(paths.user), readFileSync(paths.macros)];
  let db = new LightingDatabase(target);
  assert.deepEqual(db.importSnapshots(paths), { changed: true, tracks: 2, macros: 2 });
  const row = db.lookup(456, 123)!;
  assert.equal(row.bank, 'cool'); assert.equal(row.macroPatternId, 7);
  assert.equal(row.phrases.length, 2); assert.equal(row.phrases[1]!.macroId, 73);
  assert.equal(db.lookup(789, 123)!.bank, 'natural'); // Same song ID in another library.
  assert.equal(db.lookup(456, 999), null);
  db.saveIdentity({ masterDbId: 456, songId: 123, title: 'Synthetic', artist: 'Example', durationMs: 120000,
    phraseSha256: 'a'.repeat(64), evidence: 'synthetic fixture' });
  assert.throws(() => db.saveIdentity({ masterDbId: 456, songId: 999, title: '', artist: '', durationMs: 0, phraseSha256: '', evidence: '' }), /Unknown/);
  db.close(); const cached = readFileSync(target); db = new LightingDatabase(target);
  assert.deepEqual(db.importSnapshots(paths), { changed: false, tracks: 2, macros: 2 });
  assert.deepEqual(db.lookup(456, 123), row); db.close();
  assert.deepEqual(readFileSync(target), cached);
  assert.deepEqual(readFileSync(paths.user), originals[0]); assert.deepEqual(readFileSync(paths.macros), originals[1]);
  const inspection = new DatabaseSync(target, { readOnly: true });
  assert.equal(inspection.prepare('SELECT count(*) AS n FROM source_snapshot').get()!.n, 2);
  assert.equal(inspection.prepare("SELECT source_version FROM source_snapshot WHERE role='user'").get()!.source_version, 'synthetic-v1');
  assert.equal(inspection.prepare('SELECT data FROM rb_macro_data').get()!.data, 'timeline');
  assert.equal(inspection.prepare('SELECT value1 FROM rb_macro_event').get()!.value1, 255);
  assert.equal(inspection.prepare('SELECT title FROM track_identity').get()!.title, 'Synthetic'); inspection.close();
});

test('failed refresh rolls back the previous snapshot and ambiguous matches remain unknown', t => {
  const { paths, target } = setup(t);
  const db = new LightingDatabase(target); db.importSnapshots(paths);
  const before = db.lookup(456, 123);
  const macro = new DatabaseSync(paths.macros); macro.exec('DROP TABLE macro_event'); macro.close();
  assert.throws(() => db.importSnapshots(paths), /Missing source table/);
  assert.deepEqual(db.lookup(456, 123), before); db.close();
  const user = new DatabaseSync(paths.user); user.exec('INSERT INTO content VALUES(3,123,456,8)'); user.close();
  const repair = new DatabaseSync(paths.macros); repair.exec('CREATE TABLE macro_event(macro_data_id INTEGER,kind INTEGER,value1 INTEGER)'); repair.close();
  const reopened = new LightingDatabase(target); reopened.importSnapshots(paths);
  assert.equal(reopened.lookup(456, 123), null); reopened.close();
});

test('active journal snapshots and existing foreign targets are rejected without modifying originals', t => {
  const { paths, target } = setup(t);
  const original = readFileSync(paths.user);
  assert.throws(() => new LightingDatabase(paths.user), /not an empty/);
  assert.deepEqual(readFileSync(paths.user), original);
  const db = new LightingDatabase(target); writeFileSync(paths.user + '-wal', 'pending');
  assert.throws(() => db.importSnapshots(paths), /consistent source snapshot/); db.close();
});

test('runtime matching requires unique verified metadata and phrase fingerprint, using read-only cache', async t => {
  const { createHash } = await import('node:crypto');
  const { paths, target } = setup(t);
  const identity = { title: 'Synthetic', artist: 'Example', durationMs: 120000,
    phrases: [{ startBeat: 1, beats: 32, kind: 'intro' }] };
  const phraseSha256 = createHash('sha256').update(JSON.stringify(identity.phrases)).digest('hex');
  const db = new LightingDatabase(target); db.importSnapshots(paths);
  assert.equal(db.resolveBank(identity), null);
  const confirmed = { masterDbId: 456, songId: 123, title: identity.title, artist: identity.artist,
    durationMs: identity.durationMs, phraseSha256, evidence: 'synthetic verified mapping' };
  db.saveIdentity(confirmed); db.close();
  const before = readFileSync(target);
  const runtime = new LightingDatabase(target, true);
  assert.equal(runtime.resolveBank(identity)!.bank, 'cool');
  assert.equal(runtime.resolveBank(identity)!.masterDbId, 456);
  assert.match(runtime.resolveBank(identity)!.snapshotSha256, /^[a-f0-9]{64}$/);
  for (const other of [{ ...identity, title: 'Other' }, { ...identity, artist: 'Other' },
    { ...identity, durationMs: 120001 }, { ...identity, phrases: [] },
    { ...identity, phrases: [{ startBeat: 2, beats: 32, kind: 'intro' }] }]) assert.equal(runtime.resolveBank(other), null);
  assert.throws(() => runtime.saveIdentity(confirmed), /readonly/); runtime.close();
  assert.deepEqual(readFileSync(target), before);
  const ambiguous = new LightingDatabase(target);
  ambiguous.saveIdentity({ ...confirmed, masterDbId: 789 });
  assert.equal(ambiguous.resolveBank(identity), null); ambiguous.close();
});
