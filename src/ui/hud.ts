// DOM heads-up display, cinematic style: portrait + health + belly-bump ring, compass with objective
// markers, quest tracker with inventory, queued notifications (region reveals, quest banners, item feed,
// info lines), letterboxed dialog, interaction prompt, boss bar and the ending card.
import type { Game } from '../game/game';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
};

const UI = `${import.meta.env.BASE_URL}ui/`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** speaker -> portrait file in public/ui (The Oracle gets a drawn jade glyph) */
const PORTRAITS: Record<string, string> = {
  'Le Chonk': 'chonk', 'Papa Canard': 'canard', 'Master Tortue': 'tortue', Overfit: 'overfit', Villager: 'villager',
};

/** calligraphy subtitle for each region reveal */
const REGION_HANZI: Record<string, string> = {
  'The Valley of Peace': '和平谷', 'Village Square': '村庄广场', 'Noodle Shop': '面馆', 'Sacred Peach Tree': '圣桃树',
  'The Thousand Steps': '千阶', 'Palace of the Chonk': '胖猫宫', 'Bamboo Forest': '竹林', 'Lotus Pond': '莲池',
  'Training Arena': '练武场', 'Wolf Camp': '狼营', 'Old Peach Tree': '古桃树', 'Hill Pagoda': '山塔', 'East Bridge': '东桥',
};

// ------------------------------------------------------------------ hand-drawn icons (no gradient ids: they get removed)
type Icon = 'jade' | 'peach' | 'shoot' | 'mushroom' | 'dumpling' | 'scroll';
const ICONS: Record<Icon, string> = {
  jade: `<path d="M12 2.2 19.6 8 16.8 20.6H7.2L4.4 8Z" fill="#2c9a68"/><path d="M12 2.2 19.6 8 12 10.4 4.4 8Z" fill="#8af2c0"/><path d="M12 10.4 16.8 20.6H7.2Z" fill="#1d6e4a"/><path d="M4.4 8 12 10.4 7.2 20.6Z" fill="#3fc488"/><path d="M12 2.2 19.6 8 16.8 20.6H7.2L4.4 8Z" fill="none" stroke="#d8ffe9" stroke-opacity=".55" stroke-width=".7" stroke-linejoin="round"/>`,
  peach: `<path d="M12 7.2c-4.6 0-7.6 3.2-7.6 7.2 0 4.2 3.4 7.4 7.6 7.4s7.6-3.2 7.6-7.4c0-4-3-7.2-7.6-7.2z" fill="#f28f74"/><path d="M12 7.2c4.6 0 7.6 3.2 7.6 7.2 0 2-1 4-2.6 5.4 1-5.8-2.2-10.4-5-12.6z" fill="#e0605a" opacity=".8"/><ellipse cx="8.6" cy="12" rx="2.2" ry="3" fill="#ffd9bc" opacity=".75"/><path d="M12 7.6c-1.4 3.6-1.2 9.4.4 13.8" stroke="#c84b4b" stroke-width=".8" fill="none"/><path d="M12.2 7.4c.8-3.2 3.8-4.8 7-4.2-.7 3-3.6 4.8-7 4.2z" fill="#5fae5a"/><path d="M12.2 7.4c2-1.6 3.8-2.6 6-3.4" stroke="#2f6e33" stroke-width=".6" fill="none"/>`,
  shoot: `<path d="M12 1.8c2.6 4.6 5.6 9.6 5.6 14.6 0 3.4-2.6 5.6-5.6 5.6s-5.6-2.2-5.6-5.6c0-5 3-10 5.6-14.6z" fill="#d6b864"/><path d="M12 1.8c1.6 3 2.8 5.6 3.4 8-1.4-.6-2.4-.6-3.4 0z" fill="#8fc45a"/><path d="M6.6 16.6c2.2-1.8 8.6-1.8 10.8 0M7.8 12.2c1.6-1.4 6.8-1.4 8.4 0M9.4 8.2c1-.9 4.2-.9 5.2 0" stroke="#7a6326" stroke-width=".9" fill="none" stroke-linecap="round"/><path d="M12 22c-1.8-2.8-2.2-9.2 0-17" stroke="#fff3c4" stroke-opacity=".45" stroke-width=".8" fill="none"/>`,
  mushroom: `<path d="M9.4 12.4h5.2l.8 7.6c-1.6 1.2-5.2 1.2-6.8 0z" fill="#f1e3c6"/><path d="M2.6 12.6C2.6 6.4 7 3.4 12 3.4s9.4 3 9.4 9.2c-3 1.4-15.8 1.4-18.8 0z" fill="#a85a34"/><path d="M5 9.6c1-3 3.8-4.6 7-4.6" stroke="#e7a77a" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".8"/><circle cx="9" cy="8.6" r="1.1" fill="#f6dcc0"/><circle cx="14.6" cy="7.4" r=".9" fill="#f6dcc0"/><circle cx="16.8" cy="10.4" r="1" fill="#f6dcc0"/>`,
  dumpling: `<path d="M2.6 15.4C4 8.6 8 5.6 12 5.6s8 3 9.4 9.8c-3 2.6-15.8 2.6-18.8 0z" fill="#f6ecd4"/><path d="M7 7.8l1.4 3M10 6.2l.6 3.2M14 6.2l-.6 3.2M17 7.8l-1.4 3" stroke="#c9b48a" stroke-width=".9" stroke-linecap="round"/><path d="M4 15.6c3 1.6 13 1.6 16 0" stroke="#d8c6a0" stroke-width=".8" fill="none"/>`,
  scroll: `<rect x="5" y="4" width="14" height="16" rx="1.5" fill="#efe0b8"/><rect x="3.6" y="2.6" width="16.8" height="3" rx="1.5" fill="#b0462f"/><rect x="3.6" y="18.4" width="16.8" height="3" rx="1.5" fill="#b0462f"/><path d="M8 9h8M8 12h8M8 15h5" stroke="#8a7650" stroke-width=".9"/>`,
};
const icon = (k: Icon, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
const iconFor = (text: string): Icon => {
  const t = text.toLowerCase();
  if (t.includes('jade') || t.includes('shiny')) return 'jade';
  if (t.includes('peach')) return 'peach';
  if (t.includes('bamboo') || t.includes('shoot')) return 'shoot';
  if (t.includes('mushroom')) return 'mushroom';
  if (t.includes('scroll')) return 'scroll';
  return 'dumpling';
};

/** The Oracle: a carved jade bi disc with a glowing eye */
const ORACLE_GLYPH = `<svg viewBox="0 0 100 100" class="oracle-glyph" aria-hidden="true">
  <circle cx="50" cy="50" r="50" fill="#0b2a20"/>
  <circle cx="50" cy="50" r="38" fill="#1f7a55" stroke="#8ff0c4" stroke-opacity=".5" stroke-width="1.5"/>
  <circle cx="50" cy="50" r="31" fill="none" stroke="#bfffe0" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 4"/>
  <path d="M24 50c8-11 17-16 26-16s18 5 26 16c-8 11-17 16-26 16s-18-5-26-16z" fill="#0b2a20" stroke="#8ff0c4" stroke-width="2"/>
  <circle cx="50" cy="50" r="8.5" fill="#8ff0c4"/><circle cx="50" cy="50" r="3.6" fill="#e9fff5"/>
  <path d="M50 12v8M50 80v8M12 50h8M80 50h8" stroke="#8ff0c4" stroke-width="2" stroke-linecap="round" opacity=".7"/>
</svg>`;

const portraitHtml = (who: string) =>
  who === 'The Oracle' ? ORACLE_GLYPH : PORTRAITS[who] ? `<img src="${UI}${PORTRAITS[who]}.webp" alt="">` : `<span class="initial">${esc(who[0] ?? '?')}</span>`;

const FLOURISH = `<svg class="flourish" viewBox="0 0 400 16" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 8H178M222 8H400" stroke="currentColor" stroke-width="1"/>
  <path d="M200 1l7 7-7 7-7-7z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M200 5l3 3-3 3-3-3z" fill="currentColor"/>
  <circle cx="183" cy="8" r="1.6" fill="currentColor"/><circle cx="217" cy="8" r="1.6" fill="currentColor"/>
</svg>`;

interface Slot { el: HTMLElement; t: number; dur: number }
interface FeedItem { el: HTMLElement; t: number; key: string; n: number }

const SEG = 5, R = 46, CIRC = 2 * Math.PI * R, GAP = 3.2; // belly ring: 5 segments of 20 chi

export class Hud {
  private root: HTMLElement;
  private portrait: HTMLElement;
  private chiSegs: SVGCircleElement[] = [];
  private chiRing: HTMLElement;
  private hpFill: HTMLElement;
  private hpGhost: HTMLElement;
  private hpNum: HTMLElement;
  private bellyTag: HTMLElement;
  private quest: HTMLElement;
  private inv: HTMLElement;
  private compassMarks: HTMLElement;
  private dialog: HTMLElement;
  private dlgPortrait: HTMLElement;
  private dlgWho: HTMLElement;
  private dlgText: HTMLElement;
  private dlgNext: HTMLElement;
  private prompt: HTMLElement;
  private promptName: HTMLElement;
  private stageLayer: HTMLElement;
  private infoLayer: HTMLElement;
  private feed: HTMLElement;
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private bossGhost: HTMLElement;
  private end: HTMLElement;

  private lastQuest = '';
  private lastInv = '';
  private lastMain = '';
  private typed = 0;
  private dlgKey = '';
  private dlgSpeaker = '';
  private ghost = 1;
  private ghostHold = 0;
  private bossGhostV = 1;
  private lastHp = -1;
  private hurtT = 0;
  private ended = false;
  private lastNow = 0;

  // notification queues: one cinematic slot (regions + quests), one info slot, and a stacked item feed
  private stageQ: { kind: 'discover' | 'quest'; text: string }[] = [];
  private stageCur: Slot | null = null;
  private infoQ: string[] = [];
  private infoCur: Slot | null = null;
  private feedItems: FeedItem[] = [];

  constructor(root: HTMLElement, private game: Game) {
    this.root = root;
    root.innerHTML = '';
    root.classList.add('hud-root');

    // ---- player status
    const player = el('div', 'hud-player hud-fade', root);
    this.portrait = el('div', 'portrait', player);
    const segs = Array.from({ length: SEG }, (_, i) => {
      const rot = -90 + (i * 360) / SEG + GAP / 2;
      return `<circle class="seg-track" cx="50" cy="50" r="${R}" transform="rotate(${rot} 50 50)"/><circle class="seg-fill" cx="50" cy="50" r="${R}" transform="rotate(${rot} 50 50)"/>`;
    }).join('');
    this.chiRing = el('div', 'chi-ring', this.portrait, `<svg viewBox="0 0 100 100">${segs}</svg>`);
    this.chiSegs = Array.from(this.chiRing.querySelectorAll<SVGCircleElement>('.seg-fill'));
    const segLen = (CIRC * (360 / SEG - GAP)) / 360;
    this.chiRing.querySelectorAll<SVGCircleElement>('.seg-track').forEach((c) => c.setAttribute('stroke-dasharray', `${segLen} ${CIRC}`));
    el('div', 'face', this.portrait, `<img src="${UI}chonk.webp" alt="Le Chonk">`);

    const vit = el('div', 'vitals', player);
    el('div', 'pname', vit, '<span>Le Chonk</span><i class="seal seal-sm">胖</i>');
    const hp = el('div', 'hp', vit);
    this.hpGhost = el('div', 'hp-ghost', hp);
    this.hpFill = el('div', 'hp-fill', hp);
    const row = el('div', 'hp-row', vit);
    this.hpNum = el('span', 'hp-num', row);
    this.bellyTag = el('span', 'belly-tag', row, '<kbd>L</kbd>Belly Bump');

    // ---- compass
    const compass = el('div', 'compass hud-fade', root);
    el('div', 'compass-line', compass);
    this.compassMarks = el('div', 'compass-strip', compass);
    el('div', 'compass-needle', compass);

    // ---- quest tracker
    const q = el('div', 'hud-quest hud-fade', root);
    this.quest = el('div', 'quest-list', q);
    this.inv = el('div', 'inv', q);

    // ---- notifications
    this.stageLayer = el('div', 'stage-layer', root);
    this.infoLayer = el('div', 'info-layer', root);
    this.feed = el('div', 'item-feed', root);

    // ---- prompt
    this.prompt = el('div', 'prompt', root, '<kbd>E</kbd><span class="verb">Talk to</span>');
    this.promptName = el('span', 'who', this.prompt);

    // ---- boss
    this.boss = el('div', 'boss', root);
    el('div', 'boss-title', this.boss, '<span class="boss-name">Overfit</span><span class="boss-sub">the Tiger who memorized every move</span>');
    const bb = el('div', 'boss-bar', this.boss);
    this.bossGhost = el('div', 'boss-ghost', bb);
    this.bossFill = el('div', 'boss-fill', bb);

    // ---- dialog (letterbox)
    el('div', 'letterbox top', root);
    this.dialog = el('div', 'dialog', root);
    const inner = el('div', 'dlg-inner', this.dialog);
    this.dlgPortrait = el('div', 'dlg-portrait', inner);
    const body = el('div', 'dlg-body', inner);
    this.dlgWho = el('div', 'dlg-who', body);
    this.dlgText = el('div', 'dlg-text', body);
    this.dlgNext = el('div', 'dlg-next', inner, '<kbd>E</kbd><span>▸</span>');

    el('div', 'help', root, [
      ['← ↑ → ↓', 'move'], ['Mouse', 'look'], ['Space', 'jump'], ['J', 'punch'], ['K', 'kick'], ['L', 'belly bump'], ['E', 'talk'], ['Shift', 'walk'],
    ].map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join(''));
    this.end = el('div', 'end', root);
  }

  /** queue a notification (same entry point the game events use) */
  toast(text: string, kind = 'info') {
    if (kind === 'discover' || kind === 'quest') this.stageQ.push({ kind, text });
    else if (kind === 'item') this.pushItem(text);
    else this.infoQ.push(text);
  }

  update(dt: number, camYaw: number) {
    const g = this.game, P = g.player;
    // UI animation runs on the wall clock so a slow frame rate never stretches it
    const now = performance.now() / 1000;
    dt = this.lastNow ? Math.min(0.5, now - this.lastNow) : Math.min(dt, 0.1);
    this.lastNow = now;
    this.root.classList.toggle('in-dialog', !!g.dialog);

    // ---- health with a lagging ghost bar, low-health pulse and hurt flash
    const frac = Math.max(0, Math.min(1, P.hp / P.maxHp));
    if (frac >= this.ghost) { this.ghost = frac; this.ghostHold = 0; }
    else if ((this.ghostHold += dt) > 0.55) this.ghost = Math.max(frac, this.ghost - dt * 0.6);
    this.hpFill.style.width = `${frac * 100}%`;
    this.hpGhost.style.width = `${this.ghost * 100}%`;
    this.hpNum.innerHTML = `${Math.ceil(P.hp)}<small> / ${P.maxHp}</small>`;
    if (this.lastHp >= 0 && P.hp < this.lastHp - 0.5) this.hurtT = 0.35;
    this.lastHp = P.hp;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.portrait.classList.toggle('hurt', this.hurtT > 0);
    this.portrait.parentElement!.classList.toggle('low', frac < 0.3);

    // ---- belly-bump ring
    const segLen = (CIRC * (360 / SEG - GAP)) / 360;
    this.chiSegs.forEach((c, i) => {
      const f = Math.max(0, Math.min(1, (P.chi - i * (100 / SEG)) / (100 / SEG)));
      c.setAttribute('stroke-dasharray', `${segLen * f} ${CIRC}`);
    });
    const ready = P.chi >= Math.max(1, P.bellyCost);
    this.chiRing.classList.toggle('ready', ready);
    this.chiRing.classList.toggle('full', P.chi >= 99.9);
    this.bellyTag.classList.toggle('ready', ready);

    // ---- quest tracker: main quest first, the Dragon Noodles errand as a side quest
    const obj = g.objectives();
    let html = '', group = 'main';
    obj.forEach((o, i) => {
      const side = o.text.startsWith('Dragon Noodles');
      if (i === 0 || side) {
        group = side ? 'side' : 'main';
        const label = side ? 'Side Quest' : o.done ? 'Complete' : 'Main Quest';
        html += `<div class="q-head ${group}">${side ? '<i class="seal seal-q jade">膳</i>' : '<i class="seal seal-q">任</i>'}<span>${label}</span></div>`;
        html += `<div class="q-title ${group} ${o.done ? 'done' : ''}">${esc(o.text)}</div>`;
      } else html += `<div class="q-sub ${o.done ? 'done' : ''}"><i></i>${esc(o.text)}</div>`;
    });
    if (html !== this.lastQuest) {
      this.quest.innerHTML = html;
      this.lastQuest = html;
      const main = obj[0]?.text ?? '';
      if (main !== this.lastMain) {
        this.lastMain = main;
        this.quest.classList.remove('fresh');
        void this.quest.offsetWidth;
        this.quest.classList.add('fresh');
      }
    }
    const inv = g.inv;
    const invHtml = [
      ['jade', `${g.jadeFound.size}<small>/5</small>`, 'Jade Stones'], ['peach', inv.peach, 'Peaches'], ['shoot', inv.shoot, 'Bamboo shoots'], ['mushroom', inv.mushroom, 'Mushrooms'],
    ].map(([k, n, t]) => `<span class="inv-i ${k}" title="${t}">${icon(k as Icon)}<b>${n}</b></span>`).join('');
    if (invHtml !== this.lastInv) {
      this.inv.innerHTML = invHtml;
      this.lastInv = invHtml;
    }

    // ---- compass: 120 degrees of view, camera heading at the center
    const heading = camYaw + Math.PI;
    const HALF = Math.PI / 3;
    const marks: string[] = [];
    const rel = (b: number) => { const d = b - heading; return Math.atan2(Math.sin(d), Math.cos(d)); };
    const xOf = (d: number) => 50 - (d / HALF) * 50;
    for (let k = 0; k < 24; k++) {
      const b = Math.PI - (k * Math.PI) / 12; // clockwise from N
      const d = rel(b);
      if (Math.abs(d) > HALF) continue;
      const x = xOf(d), fade = Math.min(1, (HALF - Math.abs(d)) / 0.35).toFixed(2);
      if (k % 6 === 0) marks.push(`<div class="cm dir ${k === 0 ? 'north' : ''}" style="left:${x}%;opacity:${fade}">${'NESW'[k / 6]}</div>`);
      else if (k % 3 === 0) marks.push(`<div class="cm mid" style="left:${x}%;opacity:${fade}">${['NE', 'SE', 'SW', 'NW'][(k - 3) / 6]}</div>`);
      else marks.push(`<div class="cm tick" style="left:${x}%;opacity:${fade}"></div>`);
    }
    g.targets().forEach((t, i) => {
      const b = Math.atan2(t.x - P.pos.x, t.z - P.pos.z);
      const dist = Math.hypot(t.x - P.pos.x, t.z - P.pos.z);
      let d = rel(b);
      const off = Math.abs(d) > HALF * 0.94;
      if (off && i > 0) return;
      d = Math.max(-HALF * 0.94, Math.min(HALF * 0.94, d));
      const arrow = off ? (d > 0 ? '<em>‹</em>' : '<em>›</em>') : '';
      marks.push(`<div class="cm target ${i === 0 ? 'primary' : ''} ${off ? 'edge' : ''}" style="left:${xOf(d)}%">${arrow}<i></i><small>${Math.round(dist)} m</small></div>`);
    });
    this.compassMarks.innerHTML = marks.join('');

    // ---- interaction prompt
    const it = g.dialog ? null : g.interactable();
    this.prompt.classList.toggle('show', !!it);
    if (it && this.promptName.textContent !== it.name) this.promptName.textContent = it.name;

    // ---- dialog with a typewriter
    if (g.dialog) {
      const line = g.dialog.lines[g.dialog.i];
      const key = `${g.dialog.i}|${line.text}`;
      if (key !== this.dlgKey) {
        this.dlgKey = key;
        this.typed = 0;
        if (line.who !== this.dlgSpeaker) {
          this.dlgSpeaker = line.who;
          this.dlgPortrait.innerHTML = portraitHtml(line.who);
          this.dlgPortrait.classList.toggle('oracle', line.who === 'The Oracle');
          this.dlgWho.innerHTML = `<span>${esc(line.who)}</span><i></i>`;
          this.dialog.classList.remove('swap');
          void this.dialog.offsetWidth;
          this.dialog.classList.add('swap');
        }
      }
      this.typed = Math.min(line.text.length, this.typed + dt * 55);
      const n = Math.floor(this.typed);
      if (this.dlgText.dataset.n !== String(n)) {
        this.dlgText.dataset.n = String(n);
        this.dlgText.innerHTML = `${esc(line.text.slice(0, n))}<span class="ghost">${esc(line.text.slice(n))}</span>`;
      }
      this.dlgNext.classList.toggle('ready', n >= line.text.length);
      this.dialog.classList.add('open');
    } else {
      this.dialog.classList.remove('open');
      this.dlgSpeaker = '';
      this.dlgKey = '';
    }

    // ---- boss
    const tiger = g.tiger;
    this.boss.classList.toggle('show', !!tiger && !this.ended);
    if (tiger) {
      const f = Math.max(0, tiger.hp / tiger.maxHp);
      this.bossGhostV = f >= this.bossGhostV ? f : Math.max(f, this.bossGhostV - dt * 0.35);
      this.bossFill.style.width = `${f * 100}%`;
      this.bossGhost.style.width = `${this.bossGhostV * 100}%`;
    }

    for (const ev of g.events) {
      if (ev.type === 'toast') this.toast(ev.text, ev.kind);
      if (ev.type === 'end') this.showEnd();
    }
    this.tickNotes(dt);
  }

  // ------------------------------------------------------------------ notifications
  private tickNotes(dt: number) {
    // cinematic slot: one region reveal or quest banner at a time, shortened when others wait
    const s = this.stageCur;
    if (s) {
      s.t += dt;
      const dur = this.stageQ.length ? Math.min(s.dur, 2.6) : s.dur;
      if (s.t > dur && !s.el.classList.contains('out')) s.el.classList.add('out');
      if (s.t > dur + 0.9) { s.el.remove(); this.stageCur = null; }
    }
    if (!this.stageCur && this.stageQ.length) {
      const n = this.stageQ.shift()!;
      const e = n.kind === 'discover' ? this.discoverEl(n.text) : this.questEl(n.text);
      this.stageLayer.appendChild(e);
      this.stageCur = { el: e, t: 0, dur: n.kind === 'discover' ? 4.4 : 4 };
    }

    const f = this.infoCur;
    if (f) {
      f.t += dt;
      const dur = this.infoQ.length ? Math.min(f.dur, 2) : f.dur;
      if (f.t > dur && !f.el.classList.contains('out')) f.el.classList.add('out');
      if (f.t > dur + 0.6) { f.el.remove(); this.infoCur = null; }
    }
    if (!this.infoCur && this.infoQ.length) {
      const e = el('div', 'info', this.infoLayer, `<i class="dot"></i>${esc(this.infoQ.shift()!)}`);
      this.infoCur = { el: e, t: 0, dur: 3.2 };
    }

    for (const it of this.feedItems) {
      it.t += dt;
      if (it.t > 3.6 && !it.el.classList.contains('out')) it.el.classList.add('out');
    }
    this.feedItems = this.feedItems.filter((it) => {
      if (it.t > 4.2) { it.el.remove(); return false; }
      return true;
    });
  }

  private discoverEl(name: string) {
    const e = document.createElement('div');
    e.className = 'discover';
    const hz = REGION_HANZI[name] ?? '发现';
    const first = name === 'The Valley of Peace';
    e.innerHTML = `<div class="d-kicker">${first ? 'Chonk Fu' : 'Region Discovered'}</div>
      <div class="d-name">${esc(name)}</div>${FLOURISH}<div class="d-hanzi">${hz}</div>`;
    return e;
  }

  private questEl(text: string) {
    const clean = text.replace(/\s+$/, '');
    let label = 'Quest Updated', seal = '进', title = clean, sub = '';
    const m = /^new quest:\s*/i.exec(clean);
    if (m) { label = 'New Quest'; seal = '任'; title = clean.slice(m[0].length); }
    else if (/^you got/i.test(clean)) { label = 'Treasure Obtained'; seal = '宝'; title = clean.replace(/^you got\s*/i, '').replace(/!$/, ''); }
    else if (/^all five|^dragon noodles!/i.test(clean)) { label = 'Quest Complete'; seal = '成'; }
    if (!m) {
      const k = title.indexOf('! ');
      if (k > 0) { sub = title.slice(k + 2); title = title.slice(0, k); }
      title = title.replace(/!$/, '');
    }
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const e = document.createElement('div');
    e.className = `quest-banner ${seal === '成' ? 'complete' : ''}`;
    e.innerHTML = `<div class="qb-band"></div><i class="seal seal-stamp">${seal}</i>
      <div class="qb-text"><div class="qb-label">${label}</div><div class="qb-title">${esc(title)}</div>${sub ? `<div class="qb-sub">${esc(sub)}</div>` : ''}</div>`;
    return e;
  }

  private pushItem(text: string) {
    const g = this.game;
    const ic = iconFor(text);
    const plus = /^\+(\d+)\s+(.+)$/.exec(text);
    if (plus) {
      // stack repeated pickups of the same thing into one line
      const key = plus[2];
      const live = this.feedItems.find((f) => f.key === key && f.t < 3.2);
      const count = ic === 'jade' ? g.jadeFound.size : ic === 'dumpling' ? 0 : g.inv[ic as 'peach' | 'shoot' | 'mushroom'] ?? 0;
      const amount = (live?.n ?? 0) + Number(plus[1]);
      const html = `<span class="fi-ico">${icon(ic)}</span><span class="fi-name">${esc(key)}</span><b class="fi-plus">+${amount}</b>${count ? `<span class="fi-count">${count}</span>` : ''}`;
      if (live) {
        live.n = amount;
        live.t = 0;
        live.el.innerHTML = html;
        live.el.classList.remove('bump');
        void live.el.offsetWidth;
        live.el.classList.add('bump');
        return;
      }
      this.addFeed(html, key, amount);
    } else {
      const m = /^(.+?)!\s*(.*)$/.exec(text);
      const html = m && m[2]
        ? `<span class="fi-ico">${icon(ic)}</span><span class="fi-name">${esc(m[1])}</span><b class="fi-plus">${esc(m[2])}</b>`
        : `<span class="fi-ico">${icon(ic)}</span><span class="fi-name note">${esc(text)}</span>`;
      this.addFeed(html, text, 0);
    }
  }

  private addFeed(html: string, key: string, n: number) {
    const e = el('div', 'feed-item', this.feed, html);
    this.feedItems.push({ el: e, t: 0, key, n });
    const alive = this.feedItems.filter((f) => !f.el.classList.contains('out'));
    if (alive.length > 5) alive[0].t = Math.max(alive[0].t, 3.6);
  }

  // ------------------------------------------------------------------ ending
  private showEnd() {
    if (this.ended) return;
    this.ended = true;
    const g = this.game;
    const mins = Math.floor(g.t / 60), secs = Math.floor(g.t % 60);
    const stat = (v: string, l: string) => `<div class="es"><b>${v}</b><span>${l}</span></div>`;
    this.end.innerHTML = `<div class="end-card">
      <div class="end-hanzi">功夫胖</div>
      <div class="end-kicker">The Legend Is Written</div>
      <div class="end-title">The Chonk Warrior</div>
      ${FLOURISH}
      <p>The Oracle is awake, the Scroll is home, and the noodles are hot.</p>
      <div class="end-stats">${stat(`${mins}:${String(secs).padStart(2, '0')}`, 'Time')}${stat(String(g.stats.smashed), 'Smashed')}${stat(String(g.stats.items), 'Items')}${stat(String(g.stats.deaths), 'Naps')}</div>
      <button type="button">Play again</button>
      <i class="seal seal-end">胖</i></div>`;
    this.end.querySelector('button')!.addEventListener('click', () => location.reload());
    this.end.classList.add('show');
    this.root.classList.add('ended');
  }
}
