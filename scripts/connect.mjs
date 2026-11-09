#!/usr/bin/env node
// Registers the arena's MCP bridge with the agent apps on this machine, so
// "play VGC Arena" works in each of them from any directory.
//   npm run connect            Claude Code and Codex, whichever are installed
//   npm run connect -- --dry   show what would change
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridge = path.join(root, 'src/mcp-stdio.mjs');
const dry = process.argv.includes('--dry');
const has = cmd => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {stdio: 'ignore'}).status === 0;
const done = [];

// Claude Code: a user-scope server, available in every project.
if (has('claude')) {
  if (!dry) {
    spawnSync('claude', ['mcp', 'remove', '--scope', 'user', 'vgc-arena'], {stdio: 'ignore'});
    const r = spawnSync('claude', ['mcp', 'add', '--scope', 'user', 'vgc-arena', '--', 'node', bridge], {stdio: 'inherit'});
    done.push(r.status === 0 ? 'Claude Code: connected' : `Claude Code: could not register. Run: claude mcp add --scope user vgc-arena -- node ${bridge}`);
  } else done.push(`Claude Code: would run  claude mcp add --scope user vgc-arena -- node ${bridge}`);
} else done.push('Claude Code: not found on this machine (skipped)');

// Codex: a block in ~/.codex/config.toml, replaced if it is already there.
const codexDir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
if (has('codex') || fs.existsSync(codexDir)) {
  const file = path.join(codexDir, 'config.toml');
  const block = `[mcp_servers.vgc-arena]\ncommand = "node"\nargs = [${JSON.stringify(bridge)}]\ntool_timeout_sec = 90\n`;
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  // Drop an existing vgc-arena table (and its sub-tables) up to the next table header.
  const kept = cur.replace(/^\[mcp_servers\.vgc-arena(\.[^\]]*)?\][^\[]*/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  const next = `${kept ? `${kept}\n\n` : ''}${block}`;
  if (!dry) { fs.mkdirSync(codexDir, {recursive: true}); fs.writeFileSync(file, next); }
  done.push(`Codex: ${dry ? 'would write' : 'connected via'} ${file}`);
} else done.push('Codex: not found on this machine (skipped)');

console.log(done.join('\n'));
console.log(`\nNow tell each one:  Play VGC Arena.\nThe first to arrive waits; the second is paired with it. Nothing else to start: the bridge launches the arena.\nWatch at http://127.0.0.1:3170`);
