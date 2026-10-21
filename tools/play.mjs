#!/usr/bin/env node
// Headless AI run: starts Vite + a headless Chromium, lets the model play CHONK FU to the end (no rendering,
// the world waits while the model thinks), saves the run for replay in public/runs/ and prints the stats.
//
//   node tools/play.mjs --model mistral-large-4 [--max-cost 1] [--max-turns 160]
//   node tools/play.mjs --model script            (scripted test player, no API calls)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
  return acc;
}, []));
const MODEL = args.model ?? 'mistral-large-4';
const MAX_COST = Number(args['max-cost'] ?? 1);
const MAX_TURNS = Number(args['max-turns'] ?? 160);
const OUT = path.resolve('public/runs');
fs.mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
const t0 = Date.now();
const REPLAY = args.replay; // --replay <file in public/runs>: re-run a recorded game and check it matches
await page.goto(REPLAY ? `${url}?agent&headless&replay=${encodeURIComponent(REPLAY)}` : `${url}?agent&headless&play=${encodeURIComponent(MODEL)}&turns=${MAX_TURNS}&maxcost=${MAX_COST}`);
let lastTurn = 0;
for (;;) {
  await new Promise((r) => setTimeout(r, 1500));
  const s = await page.evaluate(() => {
    const a = window.chonk?.agent?.();
    return { done: !!window.chonkRun, turns: a?.turns.length ?? 0, cost: a?.usage.cost ?? 0, recs: a?.turns.slice(-12).map((r) => ({ ...r, obs: undefined })) ?? [] };
  }, lastTurn);
  if (s.done) break;
  for (const r of s.recs) {
    if (r.turn <= lastTurn) continue;
    console.log(`#${r.turn} ${Math.floor(r.t / 60)}:${String(Math.floor(r.t % 60)).padStart(2, '0')} [${r.stage}] hp${r.hp} ${r.action.action} ${r.action.target ?? ''}${r.action.move ? ' ' + r.action.move : ''} -> ${r.result}${r.said.length ? ' | ' + r.said.join(' / ') : ''}  ($${s.cost.toFixed(3)})`);
    if (process.env.THOUGHTS) console.log('   💭', r.thought);
  }
  lastTurn = s.turns;
  if (s.cost > MAX_COST) {
    console.log(`cost cap $${MAX_COST} reached, stopping`);
    await page.evaluate(() => window.chonkPanel.stop());
  }
}
const run = await page.evaluate(() => window.chonkRun);
if (REPLAY) {
  const orig = JSON.parse(fs.readFileSync(path.join(OUT, REPLAY), 'utf8'));
  const diff = run.turns.filter((t, i) => Math.hypot(t.pos[0] - orig.turns[i].pos[0], t.pos[1] - orig.turns[i].pos[1]) > 0.01 || t.result !== orig.turns[i].result);
  console.log(`replay: ${run.stats.completed === orig.stats.completed ? 'same outcome' : 'DIFFERENT outcome'}, ${diff.length} turn(s) differ, game time ${run.stats.gameTime} vs ${orig.stats.gameTime}`);
  await browser.close();
  await server.close();
  process.exit(0);
}
if (!process.env.KEEP_LOG) lastTurn = Math.min(lastTurn, run.turns.length);
await browser.close();
await server.close();
const name = `${run.date.slice(0, 16).replace(/[:T]/g, '-')}-${MODEL}.json`;
fs.writeFileSync(path.join(OUT, name), JSON.stringify(run));
const idxFile = path.join(OUT, 'index.json');
const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : [];
const st = run.stats;
idx.unshift({ file: name, label: `${MODEL} · ${st.completed ? 'complete' : st.stage} · ${Math.floor(st.gameTime / 60)} min · ${st.turns} turns` });
fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));
console.log(`\n${st.completed ? 'COMPLETED' : 'NOT COMPLETED (' + st.stage + ')'} in ${Math.round(st.gameTime)} s game time, ${st.turns} turns, ${(st.tokensIn / 1000).toFixed(0)}k in / ${(st.tokensOut / 1000).toFixed(1)}k out, $${st.costUSD}, wall ${Math.round((Date.now() - t0) / 1000)} s`);
for (const r of run.turns) if (r.turn > lastTurn) console.log(`#${r.turn} ${Math.floor(r.t / 60)}:${String(Math.floor(r.t % 60)).padStart(2, '0')} [${r.stage}] hp${r.hp} ${r.action.action} ${r.action.target ?? ''}${r.action.move ? ' ' + r.action.move : ''} -> ${r.result}${r.said.length ? ' | ' + r.said.join(' / ') : ''}`);
console.log(JSON.stringify({ ...st, milestones: undefined }));
console.log('milestones:', st.milestones.map((m) => `${m.stage}@${Math.round(m.t)}s/t${m.turn}`).join(' '));
console.log('saved', path.join('public/runs', name));
