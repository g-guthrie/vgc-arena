// Single entry point to the pinned Pokemon Showdown simulator.
import {createRequire} from 'node:module';
import {execSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOWDOWN_DIR = process.env.SHOWDOWN_DIR || path.join(ROOT, 'vendor', 'pokemon-showdown');
const require = createRequire(import.meta.url);
let sim;
try {
  sim = require(path.join(SHOWDOWN_DIR, 'dist', 'sim'));
} catch (err) {
  throw new Error(`Pokemon Showdown is not built at ${SHOWDOWN_DIR}. Run \`npm run setup\` first.\n${err.message}`);
}
export const {Battle, Dex, Teams, TeamValidator, toID, PRNG} = sim;

export const FORMAT_ID = process.env.VGC_FORMAT || 'gen9championsvgc2026regmcbo3';
export const format = Dex.formats.get(FORMAT_ID);
if (!format.exists) throw new Error(`Unknown format ${FORMAT_ID}`);
export const dex = Dex.forFormat(format);
export const validator = TeamValidator.get(FORMAT_ID);

let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD', {cwd: SHOWDOWN_DIR}).toString().trim(); } catch {}
export const SHOWDOWN_COMMIT = commit;
export const ROOT_DIR = ROOT;
