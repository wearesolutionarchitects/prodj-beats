import { mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { LightingDatabase } from '../infrastructure/lighting-database';

const [user, macros, target = 'data/lighting.sqlite', ...extra] = process.argv.slice(2);
if (!user || !macros || extra.length) throw new Error('Usage: npm run lighting:import -- <user.db3 snapshot> <macro.db3 snapshot> [target.sqlite]');
const path = resolve(target);
const targetIdentity = existsSync(path) ? realpathSync(path) : path;
if ([user, macros].some(source => realpathSync(source) === targetIdentity)) throw new Error('Target must differ from source databases');
mkdirSync(dirname(path), { recursive: true });
const database = new LightingDatabase(path);
try { console.log(JSON.stringify({ path, ...database.importSnapshots({ user, macros }) })); }
finally { database.close(); }
