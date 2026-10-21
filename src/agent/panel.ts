// The "Mistral plays" panel (bottom right): start a live run, watch each thought and action, replay a recorded run,
// and see the completion stats at the end.
import './agent.css';
import type { Game } from '../game/game';
import { Agent, type RunFile, type RunStats, type TurnRecord } from './agent';
import { GITHUB_MARK, MISTRAL_M, SOUND_ON, SOUND_OFF } from '../ui/icons';
import type { GameAudio } from '../audio';

const MODELS = [
  { provider: 'mistral', id: 'mistral-large-4', label: 'Mistral Large 4' },
  { provider: 'mistral', id: 'mistral-medium-latest', label: 'Mistral Medium' },
  { provider: 'mistral', id: 'mistral-small-latest', label: 'Mistral Small' },
  { provider: 'mistral', id: 'ministral-14b-latest', label: 'Ministral 14B' },
] as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function statsHtml(s: RunStats, model: string) {
  const acts = Object.entries(s.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  const ms = s.milestones.map((m) => `<li><b>${esc(m.stage)}</b><span>${mmss(m.t)} · turn ${m.turn}</span></li>`).join('');
  return `<div class="ag-stats">
    <div class="ag-verdict ${s.completed ? 'ok' : 'ko'}">${s.completed ? 'Quest complete' : `Stopped at “${esc(s.stage)}”`}</div>
    <div class="ag-model">${esc(model)}</div>
    <div class="ag-grid">
      <div><b>${mmss(s.gameTime)}</b><span>game time</span></div>
      <div><b>${s.turns}</b><span>turns</span></div>
      <div><b>$${s.costUSD.toFixed(3)}</b><span>cost</span></div>
      <div><b>${Math.round((s.tokensIn + s.tokensOut) / 1000)}k</b><span>tokens</span></div>
      <div><b>${s.deaths}</b><span>knock-outs</span></div>
      <div><b>${s.jade}/5</b><span>jade stones</span></div>
      <div><b>${s.smashed}</b><span>smashed</span></div>
      <div><b>${(s.distance / 1000).toFixed(1)} km</b><span>walked</span></div>
      <div><b>${s.failedActions}</b><span>failed actions</span></div>
    </div>
    <div class="ag-acts">${acts}</div>
    <ol class="ag-miles">${ms}</ol>
  </div>`;
}

export class AgentPanel {
  el: HTMLDivElement;
  agent: Agent | null = null;
  private log: HTMLDivElement;
  private status: HTMLDivElement;
  private now: HTMLDivElement;
  private speed = 2;

  /** in dev the Vite proxy has the key; on the website the player brings one */
  private get canPlayLive() {
    if (import.meta.env.DEV) return true;
    return !!this.el.querySelector<HTMLInputElement>('.ag-key')?.value.trim();
  }

  constructor(
    public game: Game,
    private onRun: (a: Agent | null) => void,
    /** a fresh world, in place (no reload: the music keeps playing) */
    private newGame: () => Game,
    private audio: GameAudio,
  ) {
    const el = (this.el = document.createElement('div'));
    el.className = 'ag-panel folded';
    el.innerHTML = `
      <div class="ag-head">
        <button class="hud-btn ag-play invite" title="Mistral plays the game for you">${MISTRAL_M}<span>Let Chonk play</span></button>
        <span class="ag-sound">Click for music</span>
        <button class="hud-btn icon ag-mute" title="Sound on / off (M)">${SOUND_ON}</button>
        <a class="hud-btn icon" href="https://github.com/goums/chonk-fu" target="_blank" rel="noopener" title="Source code on GitHub">${GITHUB_MARK}</a>
        <button class="hud-btn icon ag-min" title="Show / hide the AI panel">▴</button>
      </div>
      <div class="ag-body">
        <div class="ag-row">
          <button class="ag-watch">▶ Watch a run</button>
          <select class="ag-replay" title="Recorded runs"></select>
        </div>
        <div class="ag-row">
          <select class="ag-model-sel" title="Model for live play">${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select>
          <span class="ag-speed">${[1, 2, 4, 8].map((s) => `<button data-s="${s}" class="${s === 2 ? 'on' : ''}">${s}×</button>`).join('')}</span>
        </div>
        ${import.meta.env.DEV ? '' : '<div class="ag-row"><input class="ag-key" type="password" placeholder="Mistral API key to play live (stays here)" /></div>'}
        <div class="ag-status">Idle</div>
        <div class="ag-now"></div>
        <div class="ag-log"></div>
      </div>`;
    document.body.appendChild(el);
    this.log = el.querySelector('.ag-log')!;
    const keyEl = el.querySelector<HTMLInputElement>('.ag-key');
    if (keyEl) try { keyEl.value = localStorage.getItem('chonk-fu-key') ?? ''; } catch { /* private mode */ }
    this.status = el.querySelector('.ag-status')!;
    this.now = el.querySelector('.ag-now')!;
    const min = el.querySelector<HTMLButtonElement>('.ag-min')!;
    min.addEventListener('click', () => (el.classList.contains('folded') ? this.show() : this.fold()));
    const play = el.querySelector<HTMLButtonElement>('.ag-play')!;
    play.addEventListener('click', () => {
      play.blur(); // Space / Enter must not press it again
      play.classList.remove('invite');
      this.show();
      if (this.agent) this.stop();
      else if (this.canPlayLive) this.start(null);
      // no key on the website: watching a recorded run is one click away
      else this.setStatus('Watch a recorded run, or paste a Mistral API key to play live.');
    });
    // invite a click for the first 20 s
    setTimeout(() => play.classList.remove('invite'), 20000);
    const mute = el.querySelector<HTMLButtonElement>('.ag-mute')!;
    mute.addEventListener('click', () => {
      mute.blur();
      this.audio.setMuted(!this.audio.muted);
    });
    el.querySelectorAll<HTMLButtonElement>('.ag-speed button').forEach((b) =>
      b.addEventListener('click', () => {
        this.speed = +b.dataset.s!;
        el.querySelectorAll('.ag-speed button').forEach((x) => x.classList.toggle('on', x === b));
        if (this.agent) this.agent.speed = this.speed;
      }),
    );
    const sel = el.querySelector<HTMLSelectElement>('.ag-replay')!;
    fetch('./runs/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { file: string; label: string }[]) => {
        // the newest run is selected: watching is one click
        for (const r of list) sel.insertAdjacentHTML('beforeend', `<option value="${esc(r.file)}">${esc(r.label)}</option>`);
      })
      .catch(() => {});
    el.querySelector<HTMLButtonElement>('.ag-watch')!.addEventListener('click', (e) => {
      (e.currentTarget as HTMLButtonElement).blur();
      if (sel.value) this.watch(sel.value);
    });
    // keys typed in the panel must not move Le Chonk
    el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  /** unfold the log */
  show() {
    this.el.classList.remove('folded');
    this.el.querySelector('.ag-min')!.textContent = '▾';
  }

  fold() {
    this.el.classList.add('folded');
    this.el.querySelector('.ag-min')!.textContent = '▴';
  }

  /** once per frame: the sound button, and a hint when the browser still holds the music back */
  syncSound(hint: boolean) {
    this.el.classList.toggle('mute', hint);
    const off = this.audio.muted;
    if (off !== this.shownMuted) {
      this.shownMuted = off;
      const b = this.el.querySelector('.ag-mute')!;
      b.innerHTML = off ? SOUND_OFF : SOUND_ON;
      b.classList.toggle('off', off);
    }
  }
  private shownMuted = false;

  /** replay a recorded run in a fresh world */
  async watch(file: string) {
    if (this.agent) {
      this.stop();
      // let the current run wind down
      while (this.agent) await new Promise((r) => setTimeout(r, 50));
    }
    const run = (await (await fetch(`./runs/${file}`)).json()) as RunFile;
    this.start(run);
  }

  private setPlaying(on: boolean) {
    const b = this.el.querySelector('.ag-play')!;
    b.classList.toggle('on', on);
    b.querySelector('span')!.textContent = on ? 'Take control' : 'Let Chonk play';
    this.el.classList.toggle('running', on);
  }

  /**
   * Start the AI (or a replay). From a fresh game the run is recorded for replay; mid-game,
   * Le Chonk simply goes on from where the player left him.
   */
  async start(replay: RunFile | null, model?: string) {
    if (this.agent) return;
    const sel = this.el.querySelector<HTMLSelectElement>('.ag-model-sel')!;
    if (model) sel.value = model;
    const want = model ?? sel.value;
    const m = want === 'script' ? { provider: 'mistral' as const, id: 'script', label: 'Scripted player' } : MODELS.find((x) => x.id === want) ?? MODELS[0];
    // a replay needs the fresh world it was recorded in
    if (replay && this.game.t > 0) this.game = this.newGame();
    const fresh = this.game.t < 0.5;
    const keyEl = this.el.querySelector<HTMLInputElement>('.ag-key');
    const apiKey = keyEl?.value.trim() || undefined;
    if (keyEl && !replay) {
      if (!apiKey) {
        this.setStatus('Paste a Mistral API key first (console.mistral.ai).');
        return;
      }
      try { localStorage.setItem('chonk-fu-key', apiKey); } catch { /* private mode */ }
    }
    const a = (this.agent = new Agent(this.game, replay ? { provider: replay.provider, model: replay.model } : { provider: m.provider, model: m.id, apiKey, maxTurns: +(new URLSearchParams(location.search).get('turns') ?? 160), maxCost: +(new URLSearchParams(location.search).get('maxcost') ?? 1) }, replay, new URLSearchParams(location.search).has('headless')));
    a.speed = this.speed;
    this.onRun(a);
    this.setPlaying(true);
    this.log.innerHTML = '';
    this.setStatus(replay ? `Replay · ${replay.model}` : `${m.label} is playing`);
    a.onThink = () => this.setStatus(`${a.cfg.model} is thinking… · turn ${a.turns.length + 1} · $${a.usage.cost.toFixed(3)}`);
    a.onTurn = (r) => this.addTurn(r, a);
    const show = setInterval(() => {
      if (a.current && a.status === 'acting') this.now.innerHTML = `<i>${esc(a.current.thought)}</i><b>${esc(a.current.action.action)} ${esc(a.current.action.target ?? '')}${a.current.action.move ? ' · ' + a.current.action.move : ''}</b>`;
    }, 200);
    const run = await a.run();
    clearInterval(show);
    Object.assign(window, { chonkRun: run });
    this.now.innerHTML = '';
    this.setStatus(a.status === 'error' ? `Error: ${a.error}` : a.status === 'done' ? 'Finished!' : 'Stopped');
    this.log.insertAdjacentHTML('afterbegin', statsHtml(run.stats, run.model));
    if (!replay && fresh) this.offerDownload(run);
    this.agent = null;
    this.onRun(null);
    this.setPlaying(false);
  }

  stop() {
    this.agent?.stop();
  }

  private setStatus(s: string) {
    this.status.textContent = s;
  }

  private addTurn(r: TurnRecord, a: Agent) {
    const act = `${r.action.action}${r.action.target ? ' ' + r.action.target : ''}${r.action.move ? ' · ' + r.action.move : ''}`;
    this.log.insertAdjacentHTML(
      'afterbegin',
      `<div class="ag-turn"><div class="ag-t">${r.turn} · ${mmss(r.t)}</div><div class="ag-th">${esc(r.thought)}</div><div class="ag-act">${esc(act)}</div><div class="ag-res">${esc(r.result)}</div></div>`,
    );
    while (this.log.children.length > 40) this.log.lastElementChild!.remove();
    this.setStatus(`${a.cfg.model} · turn ${r.turn} · ${Math.round((a.usage.prompt + a.usage.completion) / 1000)}k tokens · $${a.usage.cost.toFixed(3)}`);
  }

  private offerDownload(run: RunFile) {
    const blob = new Blob([JSON.stringify(run)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chonk-fu-${run.model}-${run.date.slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.textContent = 'Save this run (for replay)';
    a.className = 'ag-save';
    this.log.insertAdjacentElement('afterbegin', a);
  }
}
