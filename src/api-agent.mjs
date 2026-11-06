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

// The model never handles its seat token or the lobby; the loop does.
// Teambuilding goes through the draft board only (one path, checked at every step).
// Teambuilding is guided: one question per decision, answered through a per-question
// draft_answer whose schema holds exactly the legal answers.
const HIDDEN = new Set(['arena_join', 'arena_wait', 'arena_state', 'arena_forfeit', 'arena_models', 'match_transcript', 'team_submit', 'validate_team',
  'draft_revise', 'draft_question', 'draft_answer', 'decision_schema']);
const SUBMITS = new Set(['draft_answer', 'preview_submit', 'turn_submit']);
const LIMITS = {teambuilding: 12, preview: 6, move: 6, switch: 4};
const SUBMIT_FOR = {teambuilding: 'draft_answer', preview: 'preview_submit', move: 'turn_submit', switch: 'turn_submit'};
const KEEP_PRIOR = 4;     // messages kept from before the current decision
const KEEP_TOOLS = 10;    // recent tool results kept whole within the current decision

function toolSchemas() {
  return TOOLS.filter(t => !HIDDEN.has(t.name)).map(t => {
    const {seat, ...shape} = t.input;
    const schema = z.toJSONSchema(z.object(shape));
    delete schema.$schema;
    return {type: 'function', function: {name: t.name, description: t.description, parameters: schema}};
  });
}

const SYSTEM = `You are playing in VGC Arena through function calls. Each user message is the arena's current view of your match.
Act only by calling functions. Teambuilding is a series of small questions: answer each with draft_answer (its options are the legal answers), researching first with the dex functions if you need to. Finish every other decision with exactly one submit call (preview_submit or turn_submit).
If you cannot call functions, reply with only a JSON object {"tool": "<function name>", "args": {...}} and nothing else.`;

// Pull a {"tool": name, "args": {...}} object out of a plain-text reply.
function jsonToolCall(content, tools) {
  const text = String(content || '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const tool = obj.tool || obj.name || obj.function;
      const args = obj.args || obj.arguments || obj.parameters || {};
      if (typeof tool === 'string' && tools.some(t => t.function.name === tool)) return {tool, args: typeof args === 'string' ? JSON.parse(args) : args};
    } catch {}
  }
  return null;
}

// Cheap key check before anyone waits on a match.
export async function checkKey(provider, key) {
  const url = `${PROVIDERS[provider].base}/${provider === 'openrouter' ? 'key' : 'models'}`;
  const res = await fetch(url, {headers: {authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(15000)}).catch(err => ({ok: false, status: 0, err}));
  if (res.ok) return {ok: true};
  if (res.status === 401 || res.status === 403) return {ok: false, error: `${PROVIDERS[provider].label} rejected that key.`};
  return {ok: false, error: `Couldn't reach ${PROVIDERS[provider].label} (${res.status || res.err?.message}).`};
}

export class ApiAgent {
  // Reasoning models spend output tokens thinking before they answer, so the
  // ceiling is generous; a reply cut off before any answer is retried with more.
  constructor({provider, key, model, effort, call, log = () => {}, onUsage = () => {}, maxTokens = 16000}) {
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
    this.joined = new Promise((res, rej) => { this.resolveJoined = res; this.rejectJoined = rej; });
  }

  // mode: 'required' (must call a tool), 'auto' (may answer in text), 'json'
  // (tools stay declared for the history, but the reply must be plain JSON).
  async complete(force, mode = 'required') {
    const cap = Number(process.env.VGC_API_MAX_USD || 3);
    if (this.usage.cost > cap) throw Object.assign(new Error(`spending cap of $${cap} reached for this match`), {fatal: true});
    // Only this phase's submit tool is offered, so a model can't reach for the wrong one.
    const tools = this.currentTools();
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
    const body = {model: this.model, messages, tools, tool_choice: force ? {type: 'function', function: {name: force}} : mode === 'json' ? 'none' : mode, parallel_tool_calls: false};
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
          // Some models don't take every optional knob: drop it and retry.
          const msg = String(data.error?.message || '');
          const drop = ['tool_choice', 'parallel_tool_calls', 'reasoning_effort', 'reasoning', 'max_completion_tokens'].find(k => msg.includes(k) && k in body);
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
        const cutOff = data.choices?.[0]?.finish_reason === 'length' && !(message.tool_calls || []).length;
        if (cutOff && (body.max_tokens || body.max_completion_tokens || 0) < 64000) {
          // Ran out of room while thinking: try again with double the ceiling.
          if (body.max_completion_tokens) body.max_completion_tokens *= 2; else body.max_tokens = (body.max_tokens || this.maxTokens) * 2;
          attempt--;
          continue;
        }
        if (process.env.VGC_AGENT_DEBUG) {
          const tc = (message.tool_calls || []).map(t => `${t.function?.name}(${String(t.function?.arguments || '').slice(0, 160)})`).join(' | ');
          console.error(`[debug ${this.kind}] finish=${data.choices?.[0]?.finish_reason} tools=${tc || '—'} text=${JSON.stringify(String(message.content || '').slice(0, 300))}`);
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

  // This phase's tools: research everywhere, plus exactly one way to answer.
  currentTools() {
    const research = this.tools.filter(t => !SUBMITS.has(t.function.name));
    const answer = this.answerTool || this.tools.find(t => t.function.name === SUBMIT_FOR[this.kind]);
    return [...research, answer].filter(Boolean);
  }

  // Long matches: keep the system prompt, the tail of the previous decision,
  // and the whole current decision (its instructions are never dropped);
  // older lookup results inside the decision are shortened, not removed.
  compact() {
    const start = this.decisionStart ?? 1;
    let prior = this.messages.slice(1, start).slice(-KEEP_PRIOR);
    while (prior.length && prior[0].role === 'tool') prior = prior.slice(1);
    const current = this.messages.slice(start);
    const toolIdx = current.map((m, i) => (m.role === 'tool' ? i : -1)).filter(i => i >= 0);
    const old = new Set(toolIdx.slice(0, -KEEP_TOOLS));
    const cur = current.map((m, i) => (old.has(i) && m.content.length > 400 ? {...m, content: `${m.content.slice(0, 400)}\n[…trimmed; call again if you need it]`} : m));
    return [this.messages[0], ...(start > 1 + prior.length ? [{role: 'user', content: '[Earlier decisions omitted to save context. Plans are restated in each observation.]'}] : []), ...prior, ...cur];
  }

  // One decision: show the state, let the model look things up, accept a submit.
  async decide(stateText, kind) {
    this.kind = kind;
    this.decisionStart = this.messages.length;
    this.messages.push({role: 'user', content: stateText});
    let nudges = 0;
    let limit = LIMITS[kind] || 6;
    const maxLimit = limit + 18;
    for (let i = 0; i < limit; i++) {
      // Wrap up research in time: a nudge past the budget, then force the submit.
      if (kind === 'teambuilding' && i === Math.floor(limit * 0.6)) this.messages.push({role: 'user', content: 'Answer this question now with draft_answer.'});
      // Escalation for empty replies: required tools → optional tools → plain JSON.
      const mode = nudges === 0 ? 'required' : nudges === 1 ? 'auto' : 'json';
      const force = mode === 'required' && i >= limit - 2 ? SUBMIT_FOR[kind] : null;
      const msg = await this.complete(force, mode);
      let calls = msg.tool_calls || [];
      // Fallback for models that answer in text: accept {"tool": …, "args": …}.
      if (!calls.length) {
        const fb = jsonToolCall(msg.content, this.currentTools());
        if (fb) calls = [{id: `json_${Date.now()}_${i}`, type: 'function', function: {name: fb.tool, arguments: JSON.stringify(fb.args)}}];
      }
      if (!calls.length) {
        if (++nudges > 3) break;
        const answer = this.currentTools().find(t => t.function.name === SUBMIT_FOR[kind]);
        if (msg.content) this.messages.push({role: 'assistant', content: msg.content});
        this.messages.push({role: 'user', content: nudges >= 2
          ? `Reply with ONLY a JSON object, no other text: {"tool": "${SUBMIT_FOR[kind]}", "args": <object matching this schema>}. Schema: ${JSON.stringify(answer?.function.parameters || {})}`
          : `Respond by calling ${SUBMIT_FOR[kind]} now.`});
        continue;
      }
      this.messages.push({role: 'assistant', content: msg.content || null, tool_calls: calls});
      let submitted = null;
      for (const tc of calls) {
        let args;
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = null; }
        let out;
        if (!args) out = 'INVALID ARGUMENTS: not valid JSON.';
        else if (SUBMITS.has(tc.function.name)) {
          out = await this.call(tc.function.name, {...args, seat: this.seat}, {noWait: true});
          if (!out.startsWith('REJECTED') && !out.startsWith('INVALID') && !out.startsWith('ERROR')) submitted = out;
          // A rejected submit buys a few more calls to fix the problems it names.
          else limit = Math.min(maxLimit, Math.max(limit, i + 7));
        } else out = await this.call(tc.function.name, {...args, seat: this.seat});
        this.messages.push({role: 'tool', tool_call_id: tc.id, content: String(out).slice(0, 12000)});
        this.log(`${tc.function.name}${submitted ? ' ✓' : ''}`);
      }
      if (submitted) return true;
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
    let failures = 0;
    while (!this.stopped) {
      const st = await this.call('arena_state', {seat: this.seat});
      const head = st.split('\n')[0];
      if (/FINISHED/.test(head)) return st;
      if (!/YOUR TURN/.test(head)) { await this.call('arena_wait', {seat: this.seat}); continue; }
      const kind = /TEAMBUILDING/.test(st) ? 'teambuilding' : /TEAM PREVIEW/.test(st) ? 'preview' : /DECISION: choose a replacement/.test(st) ? 'switch' : 'move';
      // Every decision is answered through a tool whose schema holds only legal answers.
      const sch = JSON.parse(await this.call('decision_schema', {seat: this.seat}));
      const base = this.tools.find(t => t.function.name === sch.tool)?.function.description || '';
      this.answerTool = sch.schema ? {type: 'function', function: {name: sch.tool, description: sch.title ? `${sch.title}. ${sch.prompt}` : base, parameters: sch.schema}} : null;
      const ok = await this.decide(st, kind);
      if (ok) { failures = 0; continue; }
      if (++failures >= 3) {
        this.log('could not produce a legal decision three times; forfeiting');
        await this.call('arena_forfeit', {seat: this.seat});
        return 'forfeited';
      }
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
