// Make sure the local arena is running, starting it if needed. Returns null
// when it is up, or a sentence saying what is wrong. The arena is started
// detached, so it outlives whichever agent happened to start it.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARENA_URL = (process.env.VGC_ARENA_URL || 'http://127.0.0.1:3170').replace(/\/$/, '');
const url = new URL(ARENA_URL);
const LOCAL = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

const up = () => fetch(`${ARENA_URL}/api/info`, {signal: AbortSignal.timeout(1500)}).then(r => r.ok, () => false);

let starting = null;
export function ensureArena() {
  return starting ||= (async () => {
    if (await up()) return null;
    if (!LOCAL || process.env.VGC_NO_AUTOSTART === '1') return `cannot reach the arena server at ${ARENA_URL}.`;
    if (!fs.existsSync(path.join(ROOT, 'vendor/pokemon-showdown/dist'))) return `the arena is not set up yet. Run \`npm install\` in ${ROOT} once, then try again.`;
    const log = fs.openSync(path.join(ROOT, 'arena.log'), 'a');
    spawn(process.execPath, [path.join(ROOT, 'src/server.mjs')], {
      cwd: ROOT, detached: true, stdio: ['ignore', log, log],
      env: {...process.env, PORT: url.port || '3170', HOST: '127.0.0.1'},
    }).unref();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (await up()) return null;
    }
    return `the arena server did not start at ${ARENA_URL}. See ${path.join(ROOT, 'arena.log')}.`;
  })().finally(() => { starting = null; });
}
