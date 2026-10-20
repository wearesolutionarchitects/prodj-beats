import { copyFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { LightingDatabase } from '../infrastructure/lighting-database';
import { syncLibrary } from '../infrastructure/rekordbox-library';

const [library, analyses, target = 'data/lighting.sqlite', ...extra] = process.argv.slice(2);
if (!library || !analyses || extra.length) throw new Error('Usage: npm run lighting:sync -- <library snapshot> <analysis root> [cache.sqlite]');
const path = resolve(target);
if (!existsSync(path)) throw new Error('Import lighting snapshots before synchronizing library identities');
if (realpathSync(path) === realpathSync(library)) throw new Error('Cache must differ from the library snapshot');
// Recoverable private backup; never overwrite a previous backup.
const backup = path + '-library-sync-backup';
if (!existsSync(backup)) copyFileSync(path, backup);
const cache = new LightingDatabase(path);
try { console.log(JSON.stringify(syncLibrary(cache, resolve(library), resolve(analyses), process.env.REKORDBOX_DB_KEY))); }
finally { cache.close(); }
