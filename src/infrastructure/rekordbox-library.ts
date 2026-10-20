import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, sep, delimiter } from 'node:path';
import { z } from 'zod';
import { phraseSchema } from '../domain/events';
import type { LightingDatabase } from './lighting-database';

const query = `SELECT c.MasterDBID AS masterDbId, c.MasterSongID AS songId,
  c.Title AS title,a.Name AS artist,c.Length*1000 AS durationMs,c.AnalysisDataPath AS analysisPath
  FROM djmdContent c LEFT JOIN djmdArtist a ON a.ID=c.ArtistID
  WHERE c.rb_local_deleted=0`;
const rowSchema = z.object({ masterDbId: z.coerce.number().int().positive(), songId: z.coerce.number().int().positive(),
  title: z.string().min(1), artist: z.string().min(1), durationMs: z.number().int().positive(), analysisPath: z.string().min(1) });
export type LibraryTrack = z.infer<typeof rowSchema>;
export const fileSha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Read a stable library snapshot; encrypted sources use SQLCipher via stdin, never CLI credentials. */
export function readLibrarySnapshot(path: string, key?: string): LibraryTrack[] {
  for (const suffix of ['-wal', '-journal']) if (existsSync(path + suffix) && statSync(path + suffix).size > 0) {
    throw new Error('Use a consistent library snapshot without an active WAL/journal');
  }
  let rows: unknown[];
  if (readFileSync(path).subarray(0, 16).toString() === 'SQLite format 3\0') {
    const db = new DatabaseSync(path, { readOnly: true });
    try { rows = db.prepare(query).all(); } finally { db.close(); }
  } else {
    if (!key) throw new Error('Encrypted library requires REKORDBOX_DB_KEY and SQLCipher');
    const result = spawnSync(process.env.SQLCIPHER_BINARY || 'sqlcipher', ['-readonly', path], {
      input: `PRAGMA key='${key.replaceAll("'", "''")}';\nPRAGMA query_only=ON;\n.mode json\n${query};\n`,
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    });
    if (result.error || result.status !== 0) throw new Error('Cannot read encrypted library snapshot with SQLCipher');
    const start = result.stdout.indexOf('[');
    rows = start < 0 ? [] : JSON.parse(result.stdout.slice(start));
  }
  return rows.flatMap(row => { const parsed = rowSchema.safeParse(row); return parsed.success ? [parsed.data] : []; });
}

/** Resolve only within the supplied analysis root, including symlink containment. */
export function analysisFile(root: string, relative: string): string | null {
  if (/[\r\n\0]/.test(relative)) return null;
  const base = realpathSync(root);
  const path = resolve(base, relative.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\.DAT$/i, '.EXT'));
  if (!path.startsWith(base + sep) || !existsSync(path)) return null;
  const real = realpathSync(path);
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null;
}

export function readAnalysisFiles(paths: string[]) {
  if (!paths.length) return new Map<string, z.infer<typeof phraseSchema>[]>();
  const jars = readdirSync('apps/bridge/lib').filter(file => file.endsWith('.jar')).map(file => resolve('apps/bridge/lib', file));
  const result = spawnSync('java', ['-cp', [resolve('apps/bridge/build/classes'), ...jars].join(delimiter),
    'com.prodjbeats.bridge.AnalysisIndex'], { input: paths.join('\n') + '\n', encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Analysis indexer failed; run npm run bridge:build first');
  const schema = z.object({ path: z.string(), phrases: z.array(phraseSchema) });
  return new Map(result.stdout.trim().split('\n').map(line => {
    const row = schema.parse(JSON.parse(line)); return [row.path, row.phrases];
  }));
}

export function syncLibrary(cache: LightingDatabase, snapshot: string, analysisRoot: string,
  key?: string, readPhrases = readAnalysisFiles) {
  const librarySha256 = fileSha256(snapshot);
  const tracks = readLibrarySnapshot(snapshot, key);
  const counts = new Map<string, number>();
  const id = (track: LibraryTrack) => `${track.masterDbId}:${track.songId}`;
  tracks.forEach(track => counts.set(id(track), (counts.get(id(track)) ?? 0) + 1));
  const candidates = tracks.filter(track => counts.get(id(track)) === 1 && cache.lookup(track.masterDbId, track.songId)?.bank);
  const files = new Map(candidates.map(track => [track.analysisPath, analysisFile(analysisRoot, track.analysisPath)]));
  const paths = [...new Set([...files.values()].filter((path): path is string => path !== null))];
  if (candidates.length && !paths.length) throw new Error('No matching analysis files under the supplied root');
  const hashes = new Map(paths.map(path => [path, fileSha256(path)]));
  const analyses = readPhrases(paths);
  const identities = candidates.flatMap(track => {
    const path = files.get(track.analysisPath);
    const phrases = path ? analyses.get(path) : null;
    if (!path || !phrases?.length) return [];
    if (fileSha256(path) !== hashes.get(path)) throw new Error('Analysis changed during library sync');
    return [{ masterDbId: track.masterDbId, songId: track.songId, title: track.title, artist: track.artist,
      durationMs: track.durationMs, phraseSha256: createHash('sha256').update(JSON.stringify(phrases)).digest('hex'),
      evidence: JSON.stringify({ method: 'rekordbox-library-anlz-v1', librarySha256,
        analysisSha256: hashes.get(path), analysisPath: track.analysisPath }) }];
  });
  if (fileSha256(snapshot) !== librarySha256) throw new Error('Library snapshot changed during sync');
  return { libraryTracks: tracks.length, lightingCandidates: candidates.length, analysedTracks: identities.length,
    changed: cache.syncLibraryIdentities(identities) };
}
