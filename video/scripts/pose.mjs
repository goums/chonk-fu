#!/usr/bin/env node
// A close shot of Le Chonk's face for the intro: the camera turns round to face him, he idles, then punches
// and belly-jumps (played with the keyboard, like a player would). No API calls.
//   node video/scripts/pose.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const W = 1920, H = 1080;
const OUT = path.resolve('video/public/footage');
const dir = path.join(OUT, 'pose-frames');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(url);
await page.addStyleTag({ content: '#game { cursor: none !important; } .ag-panel { display: none !important; }' });
await page.waitForFunction(() => window.chonk?.follow);
await page.waitForTimeout(7000); // the opening banner goes away
await page.evaluate(() => {
  const { follow, player } = window.chonk;
  follow.yaw = player.heading; // in front of him
  follow.dist = 3.6;
  follow.pitch = 0.12;
});
await page.waitForTimeout(1500);
const frames = [];
const cdp = await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  const f = path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
  fs.writeFileSync(f, Buffer.from(data, 'base64'));
  frames.push({ f, t: metadata.timestamp });
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
await page.waitForTimeout(2200);
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(380);
}
await page.waitForTimeout(500);
await page.keyboard.press('KeyK');
await page.waitForTimeout(2200);
await cdp.send('Page.stopScreencast');
await browser.close();
await server.close();
frames.sort((a, b) => a.t - b.t);
const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? fr.t + 1 / 30) - fr.t).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1).f}'\n`;
fs.writeFileSync(path.join(dir, 'list.txt'), list);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', path.join(OUT, 'pose.mp4')]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`pose: ${frames.length} frames`);
