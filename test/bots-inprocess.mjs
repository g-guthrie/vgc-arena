import {Arena} from '../src/arena.mjs';
const arena = new Arena({artifactsDir: process.env.VGC_ARTIFACTS || 'artifacts/test'});
const m = arena.createMatch({label: 'bot smoke', seed: process.argv[2] || 'smoke'});
arena.addBot(m.id, 'greedy');
arena.addBot(m.id, 'random');
await new Promise(r => m.once('finished', r));
console.log(m.events.map(e => e.text).filter(t => /game|finished|error|crash/.test(t)).join('\n'));
console.log(m.artifactPaths);
