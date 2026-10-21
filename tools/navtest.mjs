// Debug: run one skill from a given position, headless. node tools/navtest.mjs x z action target [move]
import { createServer } from 'vite';
import { chromium } from 'playwright';
const [x, z, action, target, move] = process.argv.slice(2);
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`${url}?headless`);
await page.waitForFunction(() => window.chonk?.game);
const out = await page.evaluate(async ({ x, z, action, target, move }) => {
  const { Skills, toIntent } = await import('/src/agent/skills.ts');
  const { groundAt } = await import('/src/world/world.ts');
  const g = window.chonk.game, P = g.player;
  window.chonk.external.active = true;
  P.pos.set(+x, groundAt(+x, +z), +z);
  const sk = new Skills(g);
  const path = sk.nav.path(P.pos.x, P.pos.z, ...(() => { const t = [...(g.entities), ...g.npcs].find((e) => e.id === target); return t ? [t.x, t.z] : target.split(',').map(Number); })(), 1);
  const trace = [];
  const it = sk.start({ action, target, move: move || undefined });
  let n = 0, res;
  for (;;) {
    if (g.dialog) { g.step(1 / 60, toIntent({ interact: n % 20 === 0 }), 0); n++; continue; }
    const r = it.next();
    if (r.done) { res = r.value; break; }
    g.step(1 / 60, toIntent(r.value), 0);
    if (++n % 60 === 0) trace.push([Math.round(P.pos.x * 10) / 10, Math.round(P.pos.z * 10) / 10, Math.round(P.pos.y * 10) / 10, P.swimming ? 'S' : '']);
    if (n > 60 * 200) { res = 'TIMEOUT'; break; }
  }
  return { res, pathLen: path?.length, pathHead: path?.slice(0, 40).filter((_, i) => i % 4 === 0), trace: trace.slice(0, 60) };
}, { x, z, action, target, move });
console.log(JSON.stringify(out));
await browser.close(); await server.close();
