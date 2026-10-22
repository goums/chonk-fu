#!/usr/bin/env node
// Records replays of the recorded Mistral runs as gameplay footage (no API calls: replays re-simulate the runs).
// The game fills a 1920x1080 viewport; Chrome's screencast frames are encoded to a 30 fps MP4, with the game's
// sound effects and ambience (the music is recorded apart, see music.mjs).
// A shoot is a list of game-time windows [from, to, slow]: the replay fast-forwards to each window, records it at
// real time (slow 2 = half speed, for dialogs), and the recorded windows are joined into one clip.
// The timeline (turn starts, dialog lines, joins) is saved next to the clip, in seconds of the clip.
//   node video/scripts/capture.mjs game panel
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const W = 1920, H = 1080;
const OUT = path.resolve('video/public/footage');
const RUN2 = '2026-10-21-21-19-mistral-large-4.json', RUN3 = '2026-10-21-21-23-mistral-large-4.json';
const SHOOTS = {
  // the story, panel hidden (run 3); dialogs at half speed (the game time stands still while people talk)
  game: {
    run: RUN3, panel: false, linger: 7,
    windows: [
      [0, 1.2, 1], [1.2, 2.22, 2], [2.22, 8.4, 1], // Papa Canard, the crates
      [18.5, 22.46, 1], [22.46, 22.54, 2], // Master Tortue
      [25.5, 30, 1], // the Old Peach Tree: jade 1
      [51, 58.6, 1], // swim to the pond island: jade 2
      [113, 130.5, 1], // wolves, then the belly jump on the cracked boulder: jade 3
      [147, 167, 1], // the wolf camp, the chest: jade 4
      [187.5, 193, 1], // the Palace
      [201.5, 204.96, 1], [204.96, 205.04, 2], [205.04, 211.26, 1], [211.26, 211.34, 2], [211.34, 213.1, 1], // jade 5, Overfit, PREDICTED!
      [246, 249.08, 1], [249.08, 249.16, 2], [249.16, 256, 1], // Dragon Noodles -> Dragon Chonk
      [263, 271.86, 1], [271.86, 271.94, 2], [271.94, 274, 1], // one Dragon Belly
      [291, 293.31, 1], [293.31, 293.39, 2], // the Scroll of Open Weights
      [302, 306.21, 1], [306.21, 9999, 2], // the party, the end card
    ],
  },
  // Le Chonk's face: the camera swings round to him as the first dialog ends (run 2)
  face: { run: RUN2, panel: false, linger: 0, windows: [[1.2, 2.22, 2], [2.22, 4, 1]] },
  // the AI panel open, with the thoughts (run 2): the first quest only, no spoilers
  panel: {
    run: RUN2, panel: true, linger: 0,
    windows: [[0, 2.22, 2], [2.22, 22.4, 1]],
  },
};
fs.mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });

for (const name of process.argv.slice(2)) {
  const shoot = SHOOTS[name];
  const run = JSON.parse(fs.readFileSync(`public/runs/${shoot.run}`, 'utf8'));
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url);
  await page.addStyleTag({ content: `
    #game { cursor: none !important; }
    ${shoot.panel ? '.ag-panel { zoom: 1.6; max-height: 600px !important; }' : '.ag-panel { display: none !important; }'}` });
  await page.waitForFunction(() => window.chonk?.audio && window.chonkPanel);
  // sound: effects and ambience only (the music bed is mixed in the video)
  await page.evaluate(() => {
    const a = window.chonk.audio;
    a.setMuted(false);
    a.resume();
    a.setVolume('music', 0);
  });
  await page.waitForFunction(() => window.chonk.audio.ctx?.state === 'running');
  await page.waitForTimeout(2500); // the synth renders its buffers

  // marks from the page, as they happen: recording on / off, turn starts, dialog lines (epoch seconds)
  const marks = [];
  let recNow = false, lastOff = 0;
  await page.exposeFunction('__capMark', (m) => {
    marks.push(m);
    if (m.type === 'rec') recNow = m.on;
    if (m.type === 'rec' && !m.on) lastOff = m.at;
  });

  const frames = [];
  const dir = path.join(OUT, `${name}-frames`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!recNow && metadata.timestamp - lastOff > 0.3) return; // fast-forward: not kept
    const f = path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp });
  });

  const audioT0 = await page.evaluate(({ windows, run }) => {
    const rec = new MediaRecorder(window.chonk.audio.stream(), { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    window.__chunks = [];
    rec.ondataavailable = (e) => window.__chunks.push(e.data);
    rec.start(1000);
    window.__rec = rec;
    // at a high frame rate, slow windows make every requestAnimationFrame wait a few screen frames
    const raf0 = window.requestAnimationFrame.bind(window);
    let div = 1;
    window.requestAnimationFrame = (cb) => {
      let k = 0;
      const go = (t) => (++k < div ? raf0(go) : cb(t));
      return raf0(go);
    };
    const now = () => Date.now() / 1000;
    let rec0 = false, turns = -1, line = null, agent = null, last = 0, fdt = 1 / 60, carry = 0;
    const ctl = (ts) => {
      // the screen frame rate while recording (often below 60): the sim must keep real time
      if (last) fdt += (Math.min(0.1, (ts - last) / 1000) - fdt) * 0.1;
      last = ts;
      const a = window.chonkPanel.agent, g = window.chonk.game;
      if (a && a !== agent) {
        agent = a;
        // banners raised while fast-forwarding would queue up and show later, out of place: drop them
        const ev = g.events, push = ev.push.bind(ev);
        ev.push = (...items) => push(...(rec0 ? items : items.filter((e) => e.type !== 'toast')));
        // the replay costs nothing: show what the recorded run cost, turn by turn
        const status = document.querySelector('.ag-status');
        const onTurn = a.onTurn;
        a.onTurn = (r) => {
          onTurn(r);
          const done = run.turns.slice(0, r.turn);
          const tok = done.reduce((s, x) => s + x.tokens[0] + x.tokens[1], 0), cost = done.reduce((s, x) => s + x.cost, 0);
          status.textContent = `${run.model} · turn ${r.turn} · ${Math.round(tok / 1000)}k tokens · $${cost.toFixed(3)}`;
        };
      }
      if (a) {
        const t = g.t;
        const w = windows.find((x) => t <= x[1] + 1e-3);
        let on = false, speed = 40, d = 1;
        if (w && t >= w[0] - 1e-3) {
          on = true;
          // game ticks this screen frame for real time (slow 2: half speed); under one tick, skip frames
          const r = (fdt * 60) / w[2];
          if (r >= 1) {
            carry += r;
            speed = Math.max(1, Math.floor(carry));
            carry -= speed;
          } else {
            speed = 1;
            d = Math.max(1, Math.round(1 / r));
          }
        } else if (w) speed = Math.max(1, Math.min(40, Math.round(((w[0] - t) * 60) / 15)));
        a.speed = speed;
        div = d;
        if (on !== rec0) {
          rec0 = on;
          window.__capMark({ type: 'rec', on, at: now(), t });
        }
        if (a.turns.length !== turns) {
          turns = a.turns.length;
          window.__capMark({ type: 'turn', turn: turns + 1, at: now(), t });
        }
      }
      const dl = g.dialog ? g.dialog.lines[g.dialog.i] : null;
      if (dl !== line) {
        line = dl;
        if (dl) window.__capMark({ type: 'line', who: dl.who, text: dl.text, at: now(), t: g.t });
      }
      raf0(ctl);
    };
    raf0(ctl);
    return now();
  }, { windows: shoot.windows, run });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now();
  await page.evaluate(([file, show]) => { window.chonkPanel.watch(file); if (show) window.chonkPanel.show(); }, [shoot.run, shoot.panel]);
  await page.waitForFunction(() => window.chonkRun, null, { timeout: 0, polling: 500 });
  await page.waitForTimeout(shoot.linger * 1000); // the end card
  await cdp.send('Page.stopScreencast');
  const tEnd = await page.evaluate(() => Date.now() / 1000);
  const audio = await page.evaluate(() => new Promise((res) => {
    window.__rec.onstop = async () => {
      const buf = new Uint8Array(await new Blob(window.__chunks).arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      res(btoa(s));
    };
    window.__rec.stop();
  }));
  const webm = path.join(dir, 'audio.webm');
  fs.writeFileSync(webm, Buffer.from(audio, 'base64'));
  await page.close();

  // recorded intervals (wall clock), joined end to end
  const iv = [];
  for (const m of marks.filter((x) => x.type === 'rec')) {
    if (m.on) iv.push([m.at, tEnd]);
    else if (iv.length) iv[iv.length - 1][1] = m.at;
  }
  frames.sort((a, b) => a.t - b.t);
  const out = []; // [{f, dur}]
  let base = 0;
  const clipSec = (x) => {
    let acc = 0;
    for (const [a, b] of iv) {
      if (x < a) return acc; // in a fast-forward gap: the start of the next window
      if (x <= b) return acc + (x - a);
      acc += b - a;
    }
    return acc;
  };
  for (const [a, b] of iv) {
    const fs_ = frames.filter((fr) => fr.t >= a && fr.t <= b);
    fs_.forEach((fr, i) => out.push({ f: fr.f, dur: Math.max(0.001, (fs_[i + 1]?.t ?? b) - fr.t) }));
    base += b - a;
  }
  const list = out.map((o) => `file '${o.f}'\nduration ${o.dur.toFixed(4)}`).join('\n') + `\nfile '${out.at(-1).f}'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  // the same windows cut from the audio (recorded from audioT0)
  const graph = iv.map(([a, b], i) => `[1:a]atrim=start=${(a - audioT0).toFixed(3)}:end=${(b - audioT0).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`).join(';') +
    ';' + iv.map((_, i) => `[a${i}]`).join('') + `concat=n=${iv.length}:v=0:a=1[aout]`;
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-i', webm, '-filter_complex', graph,
    '-map', '0:v', '-map', '[aout]', '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', mp4]);
  const timeline = {
    sec: +base.toFixed(2),
    joins: iv.map(([a]) => +clipSec(a).toFixed(2)),
    turns: marks.filter((m) => m.type === 'turn' && iv.some(([a, b]) => m.at >= a - 0.05 && m.at <= b)).map((m) => ({ turn: m.turn, t: +m.t.toFixed(2), sec: +clipSec(m.at).toFixed(2) })),
    lines: marks.filter((m) => m.type === 'line' && iv.some(([a, b]) => m.at >= a - 0.05 && m.at <= b)).map((m) => ({ who: m.who, text: m.text, sec: +clipSec(m.at).toFixed(2) })),
  };
  fs.writeFileSync(path.join(OUT, `${name}.timeline.json`), JSON.stringify(timeline, null, 1));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${out.length} frames, ${base.toFixed(1)} s of footage, ${((Date.now() - t0) / 1000).toFixed(0)} s wall -> ${mp4}`);
}
await browser.close();
await server.close();
