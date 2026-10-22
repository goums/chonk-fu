// The "Mistral plays" panel (bottom right): start a live run, watch each thought and action, replay a recorded run,
// and see the completion stats at the end.
import './agent.css';
import type { Game } from '../game/game';
import { Agent, type RunFile, type RunStats, type TurnRecord } from './agent';
import { GITHUB_MARK, MISTRAL_M, SOUND_ON, SOUND_OFF } from '../ui/icons';
import type { GameAudio } from '../audio';
import { lang, num, onLang, setLang, t, tf, usd } from '../i18n';

const MODELS = [
  { provider: 'mistral', id: 'mistral-large-4', label: 'Mistral Large 4' },
  { provider: 'mistral', id: 'mistral-medium-latest', label: 'Mistral Medium' },
  { provider: 'mistral', id: 'mistral-small-latest', label: 'Mistral Small' },
  { provider: 'mistral', id: 'ministral-14b-latest', label: 'Ministral 14B' },
] as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function statsHtml(s: RunStats, model: string) {
  // (action names and stage ids are the harness's own words: they stay as they are)
  const acts = Object.entries(s.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  const ms = s.milestones.map((m) => `<li><b>${esc(m.stage)}</b><span>${esc(tf('{time} · turn {n}', { time: mmss(m.t), n: m.turn }))}</span></li>`).join('');
  const cell = (v: string | number, label: string) => `<div><b>${v}</b><span>${esc(t(label))}</span></div>`;
  return `<div class="ag-stats">
    <div class="ag-verdict ${s.completed ? 'ok' : 'ko'}">${esc(s.completed ? t('Quest complete') : tf('Stopped at “{stage}”', { stage: s.stage }))}</div>
    <div class="ag-model">${esc(model)}</div>
    <div class="ag-grid">
      ${cell(mmss(s.gameTime), 'game time')}${cell(s.turns, 'turns')}${cell(usd(s.costUSD), 'cost')}
      ${cell(`${Math.round((s.tokensIn + s.tokensOut) / 1000)}k`, 'tokens')}${cell(s.deaths, 'knock-outs')}${cell(`${s.jade}/5`, 'jade stones')}
      ${cell(s.smashed, 'smashed')}${cell(`${num(s.distance / 1000, 1)} km`, 'walked')}${cell(s.failedActions, 'failed actions')}
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
  /** the status line, as a function so it can be redrawn in another language */
  private statusFn: () => string = () => t('Idle');
  private runs: { file: string; label: string }[] = [];
  private lastStats: { el: HTMLElement; stats: RunStats; model: string } | null = null;

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
        <button class="hud-btn ag-play invite">${MISTRAL_M}<span></span></button>
        <span class="ag-sound"></span>
        <button class="hud-btn icon ag-mute">${SOUND_ON}</button>
        <button class="hud-btn icon ag-lang"></button>
        <a class="hud-btn icon ag-gh" href="https://github.com/goums/chonk-fu" target="_blank" rel="noopener">${GITHUB_MARK}</a>
        <button class="hud-btn icon ag-min">▴</button>
      </div>
      <div class="ag-body">
        <div class="ag-row">
          <button class="ag-watch"></button>
          <select class="ag-replay"></select>
        </div>
        <div class="ag-row">
          <select class="ag-model-sel">${MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select>
          <span class="ag-speed">${[1, 2, 4, 8].map((s) => `<button data-s="${s}" class="${s === 2 ? 'on' : ''}">${s}×</button>`).join('')}</span>
        </div>
        ${import.meta.env.DEV ? '' : '<div class="ag-row"><input class="ag-key" type="password" /></div>'}
        <div class="ag-status"></div>
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
      else this.setStatus(() => t('Watch a recorded run, or paste a Mistral API key to play live.'));
    });
    // invite a click for the first 20 s
    setTimeout(() => play.classList.remove('invite'), 20000);
    // EN / FR: the whole page follows (the game itself stays in English underneath)
    const langBtn = el.querySelector<HTMLButtonElement>('.ag-lang')!;
    langBtn.addEventListener('click', () => {
      langBtn.blur();
      setLang(lang === 'fr' ? 'en' : 'fr');
    });
    onLang(() => this.relabel());
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
        this.runs = list;
        for (const r of list) sel.insertAdjacentHTML('beforeend', `<option value="${esc(r.file)}">${esc(t(r.label))}</option>`);
      })
      .catch(() => {});
    el.querySelector<HTMLButtonElement>('.ag-watch')!.addEventListener('click', (e) => {
      (e.currentTarget as HTMLButtonElement).blur();
      if (sel.value) this.watch(sel.value);
    });
    // keys typed in the panel must not move Le Chonk
    el.addEventListener('keydown', (e) => e.stopPropagation());
    this.relabel();
  }

  /** every label in the current language */
  private relabel() {
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s);
    const title = (s: string, text: string) => q(s)?.setAttribute('title', t(text));
    title('.ag-play', 'Mistral plays the game for you');
    q('.ag-play span')!.textContent = t(this.agent ? 'Take control' : 'Let Chonk play');
    q('.ag-sound')!.textContent = t('Click for music');
    title('.ag-mute', 'Sound on / off (M)');
    q('.ag-lang')!.textContent = lang.toUpperCase();
    q('.ag-lang')!.setAttribute('title', 'Language / Langue : English · Français');
    title('.ag-gh', 'Source code on GitHub');
    title('.ag-min', 'Show / hide the AI panel');
    q('.ag-watch')!.textContent = t('▶ Watch a run');
    title('.ag-replay', 'Recorded runs');
    title('.ag-model-sel', 'Model for live play');
    q<HTMLInputElement>('.ag-key')?.setAttribute('placeholder', t('Mistral API key to play live (stays here)'));
    this.el.querySelectorAll<HTMLOptionElement>('.ag-replay option').forEach((o, i) => (o.textContent = t(this.runs[i]?.label ?? o.textContent ?? '')));
    const save = q('.ag-save');
    if (save) save.textContent = t('Save this run (for replay)');
    if (this.lastStats?.el.isConnected) {
      const fresh = document.createRange().createContextualFragment(statsHtml(this.lastStats.stats, this.lastStats.model)).firstElementChild as HTMLElement;
      this.lastStats.el.replaceWith(fresh);
      this.lastStats.el = fresh;
    }
    this.status.textContent = this.statusFn();
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
    b.querySelector('span')!.textContent = t(on ? 'Take control' : 'Let Chonk play');
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
    const m = want === 'script' ? { provider: 'mistral' as const, id: 'script', label: t('Scripted player') } : MODELS.find((x) => x.id === want) ?? MODELS[0];
    // a replay needs the fresh world it was recorded in
    if (replay && this.game.t > 0) this.game = this.newGame();
    const fresh = this.game.t < 0.5;
    const keyEl = this.el.querySelector<HTMLInputElement>('.ag-key');
    const apiKey = keyEl?.value.trim() || undefined;
    if (keyEl && !replay) {
      if (!apiKey) {
        this.setStatus(() => t('Paste a Mistral API key first (console.mistral.ai).'));
        return;
      }
      try { localStorage.setItem('chonk-fu-key', apiKey); } catch { /* private mode */ }
    }
    const a = (this.agent = new Agent(this.game, replay ? { provider: replay.provider, model: replay.model } : { provider: m.provider, model: m.id, apiKey, maxTurns: +(new URLSearchParams(location.search).get('turns') ?? 160), maxCost: +(new URLSearchParams(location.search).get('maxcost') ?? 1) }, replay, new URLSearchParams(location.search).has('headless')));
    a.speed = this.speed;
    this.onRun(a);
    this.setPlaying(true);
    this.log.innerHTML = '';
    this.setStatus(() => (replay ? tf('Replay · {model}', { model: replay.model }) : tf('{model} is playing', { model: m.label })));
    a.onThink = () => {
      const n = a.turns.length + 1, cost = a.usage.cost;
      this.setStatus(() => tf('{model} is thinking… · turn {n} · {cost}', { model: a.cfg.model, n, cost: usd(cost) }));
    };
    a.onTurn = (r) => this.addTurn(r, a);
    const show = setInterval(() => {
      if (a.current && a.status === 'acting') this.now.innerHTML = `<i>${esc(a.current.thought)}</i><b>${esc(a.current.action.action)} ${esc(a.current.action.target ?? '')}${a.current.action.move ? ' · ' + a.current.action.move : ''}</b>`;
    }, 200);
    const run = await a.run();
    clearInterval(show);
    Object.assign(window, { chonkRun: run });
    this.now.innerHTML = '';
    const st = a.status, err = a.error;
    this.setStatus(() => (st === 'error' ? tf('Error: {error}', { error: String(err) }) : t(st === 'done' ? 'Finished!' : 'Stopped')));
    this.log.insertAdjacentHTML('afterbegin', statsHtml(run.stats, run.model));
    this.lastStats = { el: this.log.firstElementChild as HTMLElement, stats: run.stats, model: run.model };
    if (!replay && fresh) this.offerDownload(run);
    this.agent = null;
    this.onRun(null);
    this.setPlaying(false);
  }

  stop() {
    this.agent?.stop();
  }

  private setStatus(f: () => string) {
    this.statusFn = f;
    this.status.textContent = f();
  }

  private addTurn(r: TurnRecord, a: Agent) {
    const act = `${r.action.action}${r.action.target ? ' ' + r.action.target : ''}${r.action.move ? ' · ' + r.action.move : ''}`;
    this.log.insertAdjacentHTML(
      'afterbegin',
      `<div class="ag-turn"><div class="ag-t">${r.turn} · ${mmss(r.t)}</div><div class="ag-th">${esc(r.thought)}</div><div class="ag-act">${esc(act)}</div><div class="ag-res">${esc(r.result)}</div></div>`,
    );
    while (this.log.children.length > 40) this.log.lastElementChild!.remove();
    const k = Math.round((a.usage.prompt + a.usage.completion) / 1000), cost = a.usage.cost;
    this.setStatus(() => tf('{model} · turn {n} · {k}k tokens · {cost}', { model: a.cfg.model, n: r.turn, k, cost: usd(cost) }));
  }

  private offerDownload(run: RunFile) {
    const blob = new Blob([JSON.stringify(run)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chonk-fu-${run.model}-${run.date.slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.textContent = t('Save this run (for replay)');
    a.className = 'ag-save';
    this.log.insertAdjacentElement('afterbegin', a);
  }
}
