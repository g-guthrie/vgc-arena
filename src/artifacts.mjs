// Written only after a match finishes, so nothing hidden is on disk mid-match.
import fs from 'node:fs';
import path from 'node:path';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function replayHtml(title, log) {
  return `<!DOCTYPE html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title>
<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<script type="text/plain" class="battle-log-data">${String(log).replace(/<\/script/gi, '<\\/script')}</script>
</div>
<script src="https://play.pokemonshowdown.com/js/replay-embed.js"></script>
`;
}

function field(label, v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') v = JSON.stringify(v);
  return `  - **${label}:** ${v}\n`;
}

export function transcript(art) {
  const name = s => `${art.players[s]?.name} (${art.players[s]?.model})`;
  let out = `# ${art.id}${art.label ? ` — ${art.label}` : ''}\n\n`;
  out += `${art.format} · best of ${art.bestOf} · harness ${art.harnessVersion} · showdown ${art.showdownCommit.slice(0, 10)}\n\n`;
  out += `**Result:** ${art.winner === 'tie' ? 'tie' : `${name(art.winner)} wins`} ${art.score.p1}–${art.score.p2} (${art.endReason})\n\n`;
  for (const s of ['p1', 'p2']) {
    const p = art.players[s];
    if (!p) continue;
    out += `## ${s}: ${name(s)}\n\n**Team plan:** ${p.teamPlan}\n\n\`\`\`\n${p.teamText}\n\`\`\`\n\n`;
  }
  for (const g of art.games) {
    out += `## Game ${g.n} — ${g.winner === 'tie' || !g.winner ? 'tie' : `${name(g.winner)} wins`} (${g.turns} turns)\n\n`;
    for (const s of ['p1', 'p2']) {
      const pv = g.preview?.[s];
      if (!pv) continue;
      out += `**${s} preview:** brings ${pv.bring.join(', ')}\n${field('Key threats', pv.key_threats)}${field('Game plan', pv.game_plan)}${field('Lessons', pv.lessons)}\n`;
    }
    const decisions = art.decisions.filter(d => d.game === g.n && d.kind !== 'preview');
    const turns = [...new Set(decisions.map(d => d.turn))].sort((a, b) => a - b);
    for (const t of turns) {
      out += `### Turn ${t}\n`;
      for (const d of decisions.filter(x => x.turn === t)) {
        const p = d.payload;
        out += `- **${d.side}** (${d.kind}${d.depth && d.kind === 'move' ? `, ${d.depth}` : ''}${d.thinkMs ? `, ${Math.round(d.thinkMs / 1000)}s` : ''}) → \`${d.choice}\`\n`;
        out += field('Threats', p.threats) + field('Win condition', p.win_condition) + field('Predictions', (p.predictions || []).map(x => `${x.foe}: ${x.action} ${Math.round((x.confidence || 0) * 100)}%`).join('; '));
        out += field('Reason', p.reason) + field('Risk', p.risk) + field('Plan', p.plan);
        if (d.predictionScores) out += field('Prediction outcome', d.predictionScores.map(x => `${x.foe}: ${x.correct ? '✓' : '✗'} (actual ${x.actual})`).join('; '));
      }
      out += '\n';
    }
  }
  return out;
}

export function writeArtifacts(match, dir) {
  const art = match.artifact();
  const mdir = path.join(dir, 'matches', match.id);
  fs.mkdirSync(mdir, {recursive: true});
  fs.writeFileSync(path.join(mdir, 'match.json'), JSON.stringify(art, null, 1));
  fs.writeFileSync(path.join(mdir, 'transcript.md'), transcript(art));
  for (const g of art.games) {
    if (g.spectatorLog) fs.writeFileSync(path.join(mdir, `game-${g.n}.html`), replayHtml(`${match.id} game ${g.n}`, g.spectatorLog));
  }
  const scores = art.decisions.flatMap(d => (d.predictionScores || []).filter(x => x.actual !== null).map(x => ({...x, side: d.side})));
  const perSide = s => {
    const xs = scores.filter(x => x.side === s);
    const thinks = art.decisions.filter(d => d.side === s && d.thinkMs).map(d => d.thinkMs);
    return {
      predictions: xs.length,
      predictionAccuracy: xs.length ? xs.filter(x => x.correct).length / xs.length : null,
      brier: xs.length ? xs.reduce((a, x) => a + x.brier, 0) / xs.length : null,
      rejectedSubmissions: (art.rejections?.[s] || []).length,
      medianThinkMs: thinks.length ? thinks.sort((a, b) => a - b)[Math.floor(thinks.length / 2)] : null,
    };
  };
  const row = {
    id: art.id, label: art.label, finishedAt: art.finishedAt, harnessVersion: art.harnessVersion, showdownCommit: art.showdownCommit, format: art.format,
    winner: art.winner, endReason: art.endReason, score: art.score,
    games: art.games.map(g => ({n: g.n, winner: g.winner, turns: g.turns})),
    p1: {name: art.players.p1?.name, model: art.players.p1?.model, builder: match.fixedTeams?.builders?.p1 || art.players.p1?.model, teamHash: art.players.p1?.teamHash, ...perSide('p1')},
    p2: {name: art.players.p2?.name, model: art.players.p2?.model, builder: match.fixedTeams?.builders?.p2 || art.players.p2?.model, teamHash: art.players.p2?.teamHash, ...perSide('p2')},
    fixedTeams: !!match.fixedTeams,
  };
  fs.appendFileSync(path.join(dir, 'results.jsonl'), `${JSON.stringify(row)}\n`);
  return {dir: mdir, match: path.join(mdir, 'match.json'), transcript: path.join(mdir, 'transcript.md')};
}
