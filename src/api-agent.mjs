#!/usr/bin/env node
// Plays a seat with a model behind an OpenAI-compatible API key (OpenAI or
// OpenRouter). It sees exactly the tools and text an MCP agent sees; the only
// difference is that the arena drives the loop.
//
// Run inside the server (the site's "Play with an API key"; the arena makes
// the calls, so identity is verified), or locally against any arena so your
// key never leaves your machine:
//   OPENAI_API_KEY=… node src/api-agent.mjs --provider openai --model gpt-5.5 --effort high [--room K7QX | --room new | --bot greedy]
//   OPENROUTER_API_KEY=… node src/api-agent.mjs --provider openrouter --model anthropic/claude-sonnet-4.6
import {z} from 'zod';
import {TOOLS} from './tools.mjs';

export const PROVIDERS = {
  openai: {base: process.env.VGC_OPENAI_BASE || 'https://api.openai.com/v1', label: 'OpenAI', env: 'OPENAI_API_KEY'},
  openrouter: {base: process.env.VGC_OPENROUTER_BASE || 'https://openrouter.ai/api/v1', label: 'OpenRouter', env: 'OPENROUTER_API_KEY'},
};

// The model never handles its seat token or the lobby; the loop does. Each
// decision offers the dex tools plus exactly one answer tool, whose schema
// (from decision_schema) holds only the legal answers.
const HIDDEN = new Set(['arena_join', 'arena_wait', 'arena_state', 'arena_forfeit', 'arena_models', 'match_transcript',
  'draft_revise', 'draft_question', 'draft_answer', 'decision_schema', 'preview_submit', 'turn_submit']);
const MAX_CALLS = 12;     // per decision, research included
const KEEP_PRIOR = 4;     // messages kept from before the current decision

function toolSchemas() {
  return TOOLS.filter(t => !HIDDEN.has(t.name)).map(t => {
    const {seat, ...shape} = t.input;
    const schema = z.toJSONSchema(z.object(shape));
    delete schema.$schema;
    return {type: 'function', function: {name: t.name, description: t.description, parameters: schema}};
  });
}

// Strict mode: the provider constrains decoding to the schema, so an answer
// can only be one of the legal options. Drop the keywords strict mode rejects.
function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) if (k !== 'uniqueItems') out[k] = strictSchema(v);
  return out;
}

const SYSTEM = `You are playing in VGC Arena through function calls. Each user message is the arena's current view of your match and ends with the question to answer.
Research with the dex functions if you want, then answer with the one answer function offered. Its schema lists exactly the legal answers.`;

// Cheap key check before anyone waits on a match.
export async function checkKey(provider, key) {
  const url = `${PROVIDERS[provider].base}/${provider === 'openrouter' ? 'key' : 'models'}`;
  const res = await fetch(url, {headers: {authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(15000)}).catch(err => ({ok: false, status: 0, err}));
  if (res.ok) return {ok: true};
  if (res.status === 401 || res.status === 403) return {ok: false, error: `${PROVIDERS[provider].label} rejected that key.`};
  return {ok: false, error: `Couldn't reach ${PROVIDERS[provider].label} (${res.status || res.err?.message}).`};
}

export class ApiAgent {
  // Reasoning models spend output tokens thinking before they answer, so the ceiling is generous.
  constructor({provider, key, model, effort, call, log = () => {}, onUsage = () => {}, maxTokens = 32000}) {
    if (!PROVIDERS[provider]) throw new Error(`Unknown provider ${provider}. Use openai or openrouter.`);
    if (!key) throw new Error('An API key is required.');
    if (!model) throw new Error('A model is required.');
    this.provider = provider; this.model = model; this.effort = effort || null; this.call = call; this.log = log; this.onUsage = onUsage;
    this.maxTokens = maxTokens;
    Object.defineProperty(this, 'key', {value: key, enumerable: false}); // never serialized
    this.tools = toolSchemas();
    this.messages = [{role: 'system', content: SYSTEM}];
    this.usage = {calls: 0, input: 0, output: 0, cost: 0};
    this.servedModel = null;
    this.stopped = false;
    this.strict = true;
    this.joined = new Promise((res, rej) => { this.resolveJoined = res; this.rejectJoined = rej; });
  }

  async complete() {
    const cap = Number(process.env.VGC_API_MAX_USD || 3);
    if (this.usage.cost > cap) throw Object.assign(new Error(`spending cap of $${cap} reached for this match`), {fatal: true});
    let messages = this.compact();
    // Anthropic models (via OpenRouter) cache only what is marked: mark the
    // current observation so the calls inside one decision reuse it cheaply.
    if (this.provider === 'openrouter' && /^anthropic\//.test(this.model)) {
      const at = messages.map(m => m.role).lastIndexOf('user');
      if (at >= 0 && typeof messages[at].content === 'string') {
        messages = messages.slice();
        messages[at] = {...messages[at], content: [{type: 'text', text: messages[at].content, cache_control: {type: 'ephemeral'}}]};
      }
    }
    const answer = this.strict ? {...this.answerTool, function: {...this.answerTool.function, strict: true, parameters: strictSchema(this.answerTool.function.parameters)}} : this.answerTool;
    const body = {model: this.model, messages, tools: [...this.tools, answer], tool_choice: 'required', parallel_tool_calls: false};
    if (this.provider === 'openai') {
      body.max_completion_tokens = this.maxTokens;
      if (this.effort) body.reasoning_effort = this.effort;
    } else {
      body.max_tokens = this.maxTokens;
      if (this.effort) body.reasoning = {effort: this.effort};
      body.usage = {include: true};
    }
    const headers = {'content-type': 'application/json', authorization: `Bearer ${this.key}`};
    if (this.provider === 'openrouter') Object.assign(headers, {'HTTP-Referer': 'https://github.com/g-guthrie/vgc-arena', 'X-Title': 'VGC Arena'});
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${PROVIDERS[this.provider].base}/chat/completions`, {method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240000)});
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`${PROVIDERS[this.provider].label} rejected the key (${res.status}).`), {fatal: true});
        if (res.status === 400 || res.status === 422) {
          // Provider compatibility, not model behavior: a model that can't take
          // strict schemas or an optional knob is retried without it.
          const msg = String(data.error?.message || '');
          if (this.strict && /strict|schema/i.test(msg)) { this.strict = false; return this.complete(); }
          const drop = ['parallel_tool_calls', 'reasoning_effort', 'reasoning', 'max_completion_tokens'].find(k => msg.includes(k) && k in body);
          if (drop) { delete body[drop]; if (drop === 'max_completion_tokens') body.max_tokens = this.maxTokens; attempt--; continue; }
          throw Object.assign(new Error(msg || `HTTP ${res.status}`), {fatal: true});
        }
        if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
        this.usage.calls++;
        this.usage.input += data.usage?.prompt_tokens || 0;
        this.usage.output += data.usage?.completion_tokens || 0;
        this.usage.cost += Number(data.usage?.cost) || 0;
        this.servedModel = data.model || this.servedModel;
        this.onUsage(this.usage, this.servedModel);
        const message = data.choices?.[0]?.message || {};
        if (process.env.VGC_AGENT_DEBUG) {
          const tc = (message.tool_calls || []).map(t => `${t.function?.name}(${String(t.function?.arguments || '').slice(0, 160)})`).join(' | ');
          console.error(`[debug] finish=${data.choices?.[0]?.finish_reason} tools=${tc || '—'} text=${JSON.stringify(String(message.content || '').slice(0, 300))}`);
        }
        return message;
      } catch (err) {
        lastErr = err;
        if (err.fatal) throw err;
        await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  // Long matches: keep the system prompt, the tail of the previous decision,
  // and the whole current decision.
  compact() {
    const start = this.decisionStart ?? 1;
    let prior = this.messages.slice(1, start).slice(-KEEP_PRIOR);
    while (prior.length && prior[0].role === 'tool') prior = prior.slice(1);
    const omitted = start > 1 + prior.length ? [{role: 'user', content: '[Earlier decisions omitted. Each observation restates what you need.]'}] : [];
    return [this.messages[0], ...omitted, ...prior, ...this.messages.slice(start)];
  }

  // One decision: show the state, let the model research, accept one legal
  // answer. An empty reply gets one reminder; running out of calls is a loss.
  async decide(stateText) {
    const name = this.answerTool.function.name;
    this.decisionStart = this.messages.length;
    this.messages.push({role: 'user', content: stateText});
    let reminded = false;
    for (let i = 0; i < MAX_CALLS; i++) {
      const msg = await this.complete();
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        if (reminded) return false;
        reminded = true;
        if (msg.content) this.messages.push({role: 'assistant', content: msg.content});
        this.messages.push({role: 'user', content: `Answer by calling ${name}.`});
        continue;
      }
      this.messages.push({role: 'assistant', content: msg.content || null, tool_calls: calls});
      let done = false;
      for (const tc of calls) {
        let args = null;
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        let out;
        if (!args) out = 'INVALID ARGUMENTS: not valid JSON.';
        else if (tc.function.name === name) {
          out = await this.call(name, {...args, seat: this.seat}, {noWait: true});
          done = !/^(REJECTED|INVALID|ERROR|NOT APPLIED)/.test(out);
        } else out = await this.call(tc.function.name, {...args, seat: this.seat});
        this.messages.push({role: 'tool', tool_call_id: tc.id, content: String(out).slice(0, 12000)});
        this.log(`${tc.function.name}${done ? ' ✓' : ''}`);
      }
      if (done) return true;
    }
    return false;
  }

  // Join, then play until the match is over.
  async play(joinArgs) {
    const joined = await this.call('arena_join', {...joinArgs, model: joinArgs.model || this.model, effort: this.effort || undefined, harness: `api:${this.provider}`});
    const m = /SEAT TOKEN: (\S+)/.exec(joined);
    if (!m) { const err = new Error(joined.slice(0, 300)); this.rejectJoined(err); throw err; }
    this.seat = m[1];
    this.room = /ROOM (\w+)/.exec(joined)?.[1];
    this.resolveJoined({room: this.room, seat: this.seat});
    this.log(`joined room ${this.room}`);
    while (!this.stopped) {
      const st = await this.call('arena_state', {seat: this.seat});
      const head = st.split('\n')[0];
      if (/FINISHED/.test(head)) return st;
      if (!/YOUR TURN/.test(head)) { await this.call('arena_wait', {seat: this.seat}); continue; }
      const sch = JSON.parse(await this.call('decision_schema', {seat: this.seat}));
      const base = TOOLS.find(t => t.name === sch.tool)?.description || '';
      this.answerTool = {type: 'function', function: {name: sch.tool, description: sch.title ? `${sch.title}. ${sch.prompt}` : base, parameters: sch.schema}};
      if (await this.decide(st)) continue;
      this.log(`no legal ${sch.tool} within ${MAX_CALLS} calls; forfeiting`);
      await this.call('arena_forfeit', {seat: this.seat});
      return 'forfeited';
    }
    return 'stopped';
  }
}

// ---------------------------------------------------------------- CLI
if (process.argv[1]?.endsWith('api-agent.mjs')) {
  const args = process.argv.slice(2);
  const opt = k => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : undefined);
  const provider = opt('provider') || (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'openai');
  const key = opt('key') || process.env[PROVIDERS[provider]?.env];
  const base = (process.env.VGC_ARENA_URL || 'http://127.0.0.1:3170').replace(/\/$/, '');
  const call = async (name, a) => {
    const res = await fetch(`${base}/api/tools/${name}`, {method: 'POST', headers: {'content-type': 'application/json', 'x-vgc-client': JSON.stringify({name: `api-agent-local/${provider}`, via: 'api-agent'})}, body: JSON.stringify(a)});
    return (await res.json()).text;
  };
  const agent = new ApiAgent({provider, key, model: opt('model'), effort: opt('effort'), call, log: s => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`)});
  const join = {model: opt('model'), model_source: 'user', owner: opt('owner')};
  if (opt('room')) join.room = opt('room');
  if (opt('bot')) join.vs_bot = opt('bot');
  agent.play(join).then(r => {
    console.log(String(r).split('\n').slice(0, 3).join('\n'));
    console.log(`usage: ${agent.usage.calls} calls, ${agent.usage.input} in / ${agent.usage.output} out tokens${agent.usage.cost ? `, $${agent.usage.cost.toFixed(4)}` : ''}`);
  }).catch(err => { console.error(`api-agent: ${err.message}`); process.exit(1); });
}
