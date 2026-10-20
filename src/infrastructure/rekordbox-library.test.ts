import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LightingDatabase } from './lighting-database';
import { analysisFile, readLibrarySnapshot, syncLibrary } from './rekordbox-library';

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'prodj-library-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const library = join(root, 'library.sqlite');
  const db = new DatabaseSync(library);
  db.exec(`CREATE TABLE djmdArtist(ID TEXT,Name TEXT); INSERT INTO djmdArtist VALUES('1','Synthetic');
    CREATE TABLE djmdContent(MasterDBID TEXT,MasterSongID TEXT,Title TEXT,ArtistID TEXT,Length INTEGER,AnalysisDataPath TEXT,rb_local_deleted INTEGER);
    INSERT INTO djmdContent VALUES('123','456','One','1',120,'/one.DAT',0),('123','789','Two','1',120,'/two.DAT',0),
    ('123','999','Deleted','1',120,'/gone.DAT',1);`); db.close();
  const analyses = join(root, 'analyses'); mkdirSync(analyses);
  writeFileSync(join(analyses, 'one.EXT'), 'synthetic analysis one');
  writeFileSync(join(analyses, 'two.EXT'), 'synthetic analysis two');
  const target = join(root, 'lighting.sqlite');
  const cache = new LightingDatabase(target);
  const c = new DatabaseSync(target);
  c.exec(`CREATE TABLE rb_content(id INTEGER,master_db_id INTEGER,song_id INTEGER,macro_pattern_id INTEGER);
    CREATE TABLE rb_macro_pattern(id INTEGER,energy INTEGER,pattern INTEGER);
    CREATE TABLE rb_phrase_data(content_id INTEGER,phrase_num INTEGER,macro_id INTEGER,initial_macro_id INTEGER);
    CREATE TABLE rb_macro(id INTEGER,name TEXT);
    INSERT INTO rb_content VALUES(1,123,456,7),(2,123,789,8);
    INSERT INTO rb_macro_pattern VALUES(7,2,1),(8,2,5);
    INSERT INTO source_snapshot VALUES('user','synthetic','${'a'.repeat(64)}',1,'synthetic','1'),
      ('macros','synthetic','${'b'.repeat(64)}',1,'synthetic','1');`); c.close();
  t.after(() => cache.close());
  const phrases = [{ startBeat: 1, beats: 32, kind: 'intro' }];
  const reader = (paths: string[]) => new Map(paths.map(path => [path, phrases]));
  return { root, library, analyses, cache, target, reader, phrases };
}

test('library joins exact IDs and canonical analysis to multiple lighting banks, idempotently and read-only', t => {
  const s = setup(t), original = readFileSync(s.library);
  assert.equal(readLibrarySnapshot(s.library).length, 2);
  assert.deepEqual(syncLibrary(s.cache, s.library, s.analyses, undefined, s.reader),
    { libraryTracks: 2, lightingCandidates: 2, analysedTracks: 2, changed: true });
  const identity = { title: 'One', artist: 'Synthetic', durationMs: 120000, phrases: s.phrases };
  assert.equal(s.cache.resolveBank(identity)!.bank, 'cool');
  assert.equal(s.cache.resolveBank({ ...identity, title: 'Two' })!.bank, 'warm');
  const before = readFileSync(s.target);
  assert.equal(syncLibrary(s.cache, s.library, s.analyses, undefined, s.reader).changed, false);
  assert.deepEqual(readFileSync(s.target), before); assert.deepEqual(readFileSync(s.library), original);
});

test('duplicate metadata/fingerprints remain ambiguous; missing analyses remove generated stale matches', t => {
  const s = setup(t);
  const library = new DatabaseSync(s.library); library.exec("UPDATE djmdContent SET Title='One' WHERE MasterSongID='789'"); library.close();
  syncLibrary(s.cache, s.library, s.analyses, undefined, s.reader);
  assert.equal(s.cache.resolveBank({ title: 'One', artist: 'Synthetic', durationMs: 120000, phrases: s.phrases }), null);
  syncLibrary(s.cache, s.library, s.analyses, undefined, () => new Map());
  assert.equal(s.cache.resolveBank({ title: 'One', artist: 'Synthetic', durationMs: 120000, phrases: s.phrases }), null);
  const db = new DatabaseSync(s.target, { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM track_identity').get()!.n, 0); db.close();
});

test('unsafe paths, active journals, changed analyses and failed batches do not publish mappings', t => {
  const s = setup(t);
  assert.equal(analysisFile(s.analyses, '../library.sqlite'), null);
  symlinkSync(s.library, join(s.analyses, 'escape.EXT'));
  assert.equal(analysisFile(s.analyses, 'escape.DAT'), null);
  writeFileSync(s.library + '-wal', 'active');
  assert.throws(() => readLibrarySnapshot(s.library), /consistent/); rmSync(s.library + '-wal');
  assert.throws(() => syncLibrary(s.cache, s.library, s.analyses, undefined, paths => {
    writeFileSync(paths[0]!, 'changed'); return s.reader(paths);
  }), /changed/);
  assert.throws(() => s.cache.syncLibraryIdentities([
    { masterDbId: 123, songId: 456, title: 'Valid', artist: 'Synthetic', durationMs: 1, phraseSha256: 'a', evidence: '{}' },
    { masterDbId: 123, songId: 999, title: 'Invalid', artist: 'Synthetic', durationMs: 1, phraseSha256: 'b', evidence: '{}' }
  ]), /Unknown/);
  const db = new DatabaseSync(s.target, { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM track_identity').get()!.n, 0); db.close();
});

test('generated library mappings feed the same live/replay reducer for successive tracks', async t => {
  const { CachedEventSource } = await import('../application/cached-event-source');
  const { observeSession } = await import('../application/event-source');
  const { ProDjLinkSession } = await import('../application/session');
  const s = setup(t); syncLibrary(s.cache, s.library, s.analyses, undefined, s.reader);
  const results = [];
  for (const status of ['live', 'replay'] as const) {
    const session = new ProDjLinkSession(); let observer!: import('../application/event-source').EventObserver;
    const stop = observeSession(new CachedEventSource({ subscribe(value) { observer = value; return () => {}; } },
      async identity => s.cache.resolveBank(identity)), session, () => {}, () => {});
    observer.status(status);
    for (const [index, title] of ['One', 'Two'].entries()) {
      const source = { id: index + 1, player: 1, slot: 'USB_SLOT' };
      observer.event({ type: 'track', version: 2, ms: index * 10 + 1,
        payload: { player: 1, source, title, artist: 'Synthetic', duration: 120000 } });
      observer.event({ type: 'structure', version: 2, ms: index * 10 + 2,
        payload: { player: 1, source, bank: 'default', mood: 'mid', phrases: s.phrases } });
      await new Promise(resolve => setTimeout(resolve, 0));
      const structure = session.snapshot().decks[0]!.structure!;
      assert.equal(structure.bank, index === 0 ? 'cool' : 'warm'); assert.equal(structure.bankOrigin, 'sqlite');
    }
    results.push(session.snapshot()); stop();
  }
  assert.deepEqual(results[0], results[1]);
});

test('refresh retains independent confirmations and rolls back existing generated mappings on failure', t => {
  const s = setup(t);
  const extra = new DatabaseSync(s.target);
  extra.exec('INSERT INTO rb_content VALUES(3,123,999,7)'); extra.close();
  const manual = { masterDbId: 123, songId: 999, title: 'Manual', artist: 'Synthetic',
    durationMs: 1000, phraseSha256: 'c'.repeat(64), evidence: 'independently confirmed' };
  s.cache.saveIdentity(manual);
  syncLibrary(s.cache, s.library, s.analyses, undefined, s.reader);
  assert.throws(() => s.cache.syncLibraryIdentities([{ ...manual, songId: 1000 }]), /Unknown/);
  assert.equal(s.cache.resolveBank({ title: 'One', artist: 'Synthetic', durationMs: 120000, phrases: s.phrases })!.bank, 'cool');
  syncLibrary(s.cache, s.library, s.analyses, undefined, () => new Map());
  const db = new DatabaseSync(s.target, { readOnly: true });
  assert.equal(db.prepare('SELECT evidence FROM track_identity WHERE song_id=999').get()!.evidence, manual.evidence);
  assert.equal(db.prepare('SELECT count(*) AS n FROM track_identity').get()!.n, 1); db.close();
});
