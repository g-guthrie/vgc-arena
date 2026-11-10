// `npm install` is the whole setup: it also fetches and builds the pinned
// simulator, unless that is already done. VGC_SKIP_SETUP=1 skips it.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.VGC_SKIP_SETUP === '1' || fs.existsSync(path.join(root, 'vendor/pokemon-showdown/dist'))) process.exit(0);
console.log('vgc-arena: fetching and building the Pokémon Showdown simulator (once, about a minute)…');
const r = spawnSync('bash', [path.join(root, 'scripts/setup-showdown.sh')], {stdio: 'inherit'});
if (r.status !== 0) console.error('vgc-arena: simulator setup failed. Run `npm run setup` to try again.');
process.exit(r.status || 0);
