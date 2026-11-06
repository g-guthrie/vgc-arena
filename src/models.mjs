// Canonical model identity. A model can't be proven over MCP, so identity is
// self-reported, then normalized against models.json and cross-checked against
// whatever the transport tells us about the client. Disagreements become flags
// that the stats pages can filter on.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT_DIR} from './showdown.mjs';

const norm = s => String(s || '').toLowerCase().replace(/^(anthropic|openai|deepseek|moonshotai|google)\//, '').replace(/[\s_.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

let registry;
export function loadRegistry() {
  const file = process.env.VGC_MODELS || path.join(ROOT_DIR, 'models.json');
  registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  registry.byKey = new Map();
  for (const m of registry.models) {
    for (const key of [m.id, m.name, ...(m.aliases || [])]) registry.byKey.set(norm(key), m);
  }
  return registry;
}
loadRegistry();

export function listModels() {
  return registry.models.filter(m => m.provider !== 'arena').map(m => ({id: m.id, name: m.name, provider: m.provider}));
}
export function modelInfo(id) { return registry.models.find(m => m.id === id) || null; }
export const EFFORTS = () => registry.efforts;

// "claude-opus-5-5", "Opus 5.5", "gpt-5.6-luna:high", "openai/gpt-5.5" …
export function resolveModel(raw, effortRaw) {
  let text = String(raw || '').trim();
  let effort = effortRaw ? norm(effortRaw) : null;
  const colon = /^(.*?)[:@](none|minimal|low|medium|high|xhigh|x-high|max)$/i.exec(text);
  if (colon) { text = colon[1]; effort ||= norm(colon[2]).replace('x-high', 'xhigh'); }
  if (effort && !registry.efforts.includes(effort)) effort = null;
  const hit = registry.byKey.get(norm(text));
  if (hit) return {modelId: hit.id, name: hit.name, provider: hit.provider, listed: true, effort, raw: String(raw)};
  return {modelId: `unlisted:${norm(text) || 'unknown'}`, name: text || 'unknown', provider: 'unknown', listed: false, effort, raw: String(raw)};
}

export function detectHarness(clientName, userAgent) {
  const hay = `${clientName || ''} ${userAgent || ''}`.toLowerCase();
  for (const [id, h] of Object.entries(registry.harnesses || {})) {
    if (h.match.some(m => hay.includes(m))) return id;
  }
  return null;
}

export function identityFlags(identity, client = {}) {
  const flags = [];
  if (!identity.listed) flags.push('unlisted-model');
  const detected = detectHarness(client.name, client.userAgent);
  const h = detected && registry.harnesses[detected];
  if (h && identity.listed && identity.provider !== 'arena' && !h.providers.includes(identity.provider)) flags.push(`harness-provider-mismatch:${detected}/${identity.provider}`);
  if (!client.name && !client.userAgent) flags.push('no-client-info');
  return {detectedHarness: detected, flags};
}
