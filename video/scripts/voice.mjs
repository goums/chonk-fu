#!/usr/bin/env node
// CHONK FU: generates the voice-over with Voxtral TTS (Mistral Studio key from .env).
// Each line is split into sentences (and at "..." hesitations), generated chunk by chunk, checked with Voxtral
// transcription (retried if words are missing), then joined with natural pauses and a light broadcast chain.
// Cached by content: only changed lines are regenerated.
//   node video/scripts/voice.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const KEY = process.env.MISTRAL_STUDIO_API_KEY;
const MODEL = 'voxtral-mini-tts-3';
const { voices, lines } = JSON.parse(fs.readFileSync('video/voice/script.json', 'utf8'));
const OUT = 'video/public/voice';
const TMP = 'video/out/voice-tmp';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const words = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);

/** "Okay, so... meet Le Chonk. He's big." -> [{text: "Okay, so...", pause: 0.6}, {text: "meet Le Chonk.", pause: 0.35}, ...] */
function chunks(text) {
  const out = [];
  for (const m of text.matchAll(/[^.!?…]+(?:\.\.\.|…|[.!?]+)?["”]?\s*/g)) {
    const t = m[0].trim();
    if (!t) continue;
    out.push({ text: t, pause: /(\.\.\.|…)["”]?$/.test(t) ? 0.6 : /[?!]["”]?$/.test(t) ? 0.45 : 0.35 });
  }
  return out;
}

async function tts(text, voice, file) {
  const r = await fetch('https://api.mistral.ai/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, voice_id: voice, input: text, response_format: 'wav' }),
  });
  const d = await r.json();
  if (!d.audio_data) throw new Error(`tts: ${JSON.stringify(d).slice(0, 200)}`);
  fs.writeFileSync(file, Buffer.from(d.audio_data, 'base64'));
}

async function transcribe(file) {
  const fd = new FormData();
  fd.append('model', 'voxtral-mini-latest');
  fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const r = await fetch('https://api.mistral.ai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd });
  return (await r.json()).text ?? '';
}

const manifest = [];
for (const l of lines) {
  const voice = voices[l.who];
  const hash = crypto.createHash('sha1').update(`${MODEL}|${voice}|${l.text}|chunked2`).digest('hex').slice(0, 10);
  const file = path.join(OUT, `${l.id}-${hash}.mp3`);
  if (!fs.existsSync(file)) {
    const parts = [];
    for (const [i, c] of chunks(l.text).entries()) {
      // generate, then check every word made it (the voice sometimes drops or drags words); keep the best of 3
      let best = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const raw = path.join(TMP, `${l.id}-${i}-${attempt}.wav`);
        await tts(c.text, voice, raw);
        const clean = raw.replace('.wav', '.trim.wav');
        const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03';
        ff('-i', raw, '-af', `${trim},areverse,${trim},areverse,silenceremove=stop_periods=-1:stop_duration=0.45:stop_silence=0.3:stop_threshold=-45dB`, clean);
        const want = words(c.text), heard = new Set(words(await transcribe(clean)));
        const score = want.length ? want.filter((w) => heard.has(w)).length / want.length : 1;
        const perWord = dur(clean) / Math.max(1, c.text.split(/\s+/).length);
        const rank = score - (perWord > 0.6 ? 0.5 : 0); // all words there, and not dragging
        if (!best || rank > best.rank) best = { clean, rank };
        if (score >= 0.8 && perWord <= 0.6) break;
        console.log(`  retry ${l.id}#${i} (words ${(score * 100) | 0}%, ${perWord.toFixed(2)} s/word): ${c.text}`);
      }
      parts.push({ file: best.clean, pause: c.pause });
    }
    // join with natural pauses, then a gentle broadcast chain: rumble cut, soft compression, a touch of warmth
    const inputs = parts.flatMap((p) => ['-i', p.file]);
    const graph = parts.map((p, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${i < parts.length - 1 ? p.pause : 0}[a${i}]`).join(';') +
      ';' + parts.map((_, i) => `[a${i}]`).join('') + `concat=n=${parts.length}:v=0:a=1,highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=10:release=160:makeup=2,equalizer=f=180:t=q:w=1:g=2[out]`;
    ff(...inputs, '-filter_complex', graph, '-map', '[out]', '-b:a', '192k', file);
    console.log('generated', file);
  }
  manifest.push({ id: l.id, who: l.who, text: l.text, file: path.relative('video/public', file), sec: +dur(file).toFixed(2) });
}
fs.rmSync(TMP, { recursive: true, force: true });
fs.writeFileSync('video/src/voice.json', JSON.stringify(manifest, null, 1));
console.log(manifest.map((m) => `${m.id.padEnd(7)} ${m.sec.toFixed(1)} s`).join('\n'));
