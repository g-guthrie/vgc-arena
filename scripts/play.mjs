#!/usr/bin/env node
// What an agent runs to play: starts the arena if it is not running, then
// prints the instructions to follow.   npm run play [-- ROOMCODE | new]
import {ensureArena, ARENA_URL} from '../src/ensure-arena.mjs';

const problem = await ensureArena();
if (problem) { console.error(`vgc-arena: ${problem}`); process.exit(1); }
const room = process.argv[2] ? `/${encodeURIComponent(process.argv[2])}` : '';
process.stdout.write(await (await fetch(`${ARENA_URL}/go${room}`)).text());
