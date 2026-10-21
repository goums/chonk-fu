#!/usr/bin/env node
// Records the game's generative score (synthesized live by the game) in one mood, without effects or ambience.
//   node video/scripts/music.mjs village:75 combat:45 palace:40 ending:45
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.resolve('video/public/music');
fs.mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const spec of process.argv.slice(2)) {
  const [mood, secs] = spec.split(':');
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  await page.goto(url + '?nopost');
  await page.waitForFunction(() => window.chonk?.audio);
  await page.evaluate((mood) => {
    const a = window.chonk.audio;
    a.forceMood = mood;
    a.setMuted(false);
    a.resume();
    a.setVolume('sfx', 0);
    a.setVolume('ambience', 0);
  }, mood);
  await page.waitForFunction(() => window.chonk.audio.ctx?.state === 'running');
  await page.waitForTimeout(6000); // the opening sting fades, the mood settles
  const b64 = await page.evaluate(async (ms) => {
    const rec = new MediaRecorder(window.chonk.audio.stream(), { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(1000);
    await new Promise((r) => setTimeout(r, ms));
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, Number(secs) * 1000);
  const webm = path.join(OUT, `${mood}.webm`);
  fs.writeFileSync(webm, Buffer.from(b64, 'base64'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-b:a', '192k', path.join(OUT, `${mood}.mp3`)]);
  fs.rmSync(webm);
  console.log(mood, 'ok');
  await page.close();
}
await browser.close();
await server.close();
