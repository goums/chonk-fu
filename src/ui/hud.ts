// DOM heads-up display, cinematic style: portrait + health + belly-jump ring, compass with objective
// markers, quest tracker with inventory, queued notifications (region reveals, quest banners, item feed,
// info lines), letterboxed dialog, interaction prompt, boss bar and the ending card.
import type { Game } from '../game/game';
import { ICONS, type Icon } from '../game/itemIcons';
import { lang, num, t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
};

const UI = `${import.meta.env.BASE_URL}ui/`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** speaker -> portrait file in public/ui (The Oracle gets a drawn jade glyph); NPCs map by species below */
const PORTRAITS: Record<string, string> = {
  'Le Chonk': 'chonk', 'Papa Canard': 'canard', 'Master Tortue': 'tortue', Overfit: 'overfit',
};
/** character species -> portrait, for named villagers ("Bao" the pig, "Lin" the bunny...) */
const KIND_PORTRAIT: Record<string, string> = {
  chonk: 'chonk', duck: 'canard', tortoise: 'tortue', tiger: 'overfit', pig: 'villager', bunny: 'bunny',
};

/** calligraphy subtitle for each region reveal */
const REGION_HANZI: Record<string, string> = {
  'The Valley of Peace': '和平谷', 'Village Square': '村庄广场', 'Noodle Shop': '面馆', 'Sacred Peach Tree': '圣桃树',
  'The Thousand Steps': '千阶', 'Palace of the Chonk': '胖猫宫', 'Bamboo Forest': '竹林', 'Lotus Pond': '莲池',
  'Training Arena': '练武场', 'Wolf Camp': '狼营', 'Old Peach Tree': '古桃树', 'Hill Pagoda': '山塔', 'East Bridge': '东桥',
};

const icon = (k: Icon, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
const iconFor = (text: string): Icon => {
  const s = text.toLowerCase();
  if (s.includes('jade') || s.includes('shiny')) return 'jade';
  if (s.includes('peach')) return 'peach';
  if (s.includes('bamboo') || s.includes('shoot')) return 'shoot';
  if (s.includes('mushroom')) return 'mushroom';
  if (s.includes('scroll')) return 'scroll';
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

const portraitHtml = (who: string, kind?: string) => {
  if (who === 'The Oracle') return ORACLE_GLYPH;
  const file = PORTRAITS[who] ?? (kind ? KIND_PORTRAIT[kind] : undefined);
  return file ? `<img src="${UI}${file}.webp" alt="">` : `<span class="initial">${esc(who[0] ?? '?')}</span>`;
};

const FLOURISH = `<svg class="flourish" viewBox="0 0 400 16" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 8H178M222 8H400" stroke="currentColor" stroke-width="1"/>
  <path d="M200 1l7 7-7 7-7-7z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M200 5l3 3-3 3-3-3z" fill="currentColor"/>
  <circle cx="183" cy="8" r="1.6" fill="currentColor"/><circle cx="217" cy="8" r="1.6" fill="currentColor"/>
</svg>`;

interface Slot { el: HTMLElement; t: number; dur: number; replay?: { kind: 'discover' | 'quest'; text: string } }
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
  private compassTargets!: HTMLElement;
  private targetEls: { el: HTMLElement; dist: HTMLElement; name: HTMLElement; arrow: HTMLElement }[] = [];
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
  private tut: HTMLElement;
  private lastTut = '';
  private flash: HTMLElement;
  private player: HTMLElement;
  private bossFill: HTMLElement;
  private bossGhost: HTMLElement;
  private end: HTMLElement;
  private help: HTMLElement;
  private promptVerb: HTMLElement;
  private bossSub: HTMLElement;
  /** the language the static labels are in (they are redrawn when it changes) */
  private shownLang = '';

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
    this.flash = el('div', 'screen-flash', root);
    const player = (this.player = el('div', 'hud-player hud-fade', root));
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
    this.bellyTag = el('span', 'belly-tag', row);


    // ---- compass
    const compass = el('div', 'compass hud-fade', root);
    el('div', 'compass-line', compass);
    this.compassMarks = el('div', 'compass-strip', compass);
    this.compassTargets = el('div', 'compass-targets hud-fade', root);
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
    this.prompt = el('div', 'prompt', root, '<kbd class="wide"></kbd><span class="verb"></span>');
    this.promptVerb = this.prompt.querySelector('.verb')!;
    this.promptName = el('span', 'who', this.prompt);

    // ---- training key hints (Training Arena)
    this.tut = el('div', 'tutorial', root);

    // ---- boss
    this.boss = el('div', 'boss', root);
    el('div', 'boss-title', this.boss, '<span class="boss-name">Overfit</span><span class="boss-sub"></span>');
    this.bossSub = this.boss.querySelector('.boss-sub')!;
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
    this.dlgNext = el('div', 'dlg-next', inner, '<kbd class="wide"></kbd><span>▸</span>');

    this.help = el('div', 'help', root);
    this.end = el('div', 'end', root);
    this.relabel();
  }

  /** the static labels, in the current language */
  private relabel() {
    this.shownLang = lang;
    this.bellyTag.innerHTML = `<kbd>K</kbd>${esc(t(this.game.dragon ? 'Dragon Belly' : 'Belly Jump'))}`;
    this.prompt.querySelector('kbd')!.textContent = t('Enter');
    this.promptVerb.textContent = t('Talk to');
    this.bossSub.textContent = t('He knows every kung fu move');
    this.dlgNext.querySelector('kbd')!.textContent = t('Enter');
    this.help.innerHTML = [
      ['Arrows', 'move'], ['Shift', 'sprint'], ['Space', 'jump'], ['J', 'punch (combo)'], ['K', 'belly jump'], ['Enter', 'talk'], ['', 'drag mouse to look'],
    ].map(([k, v]) => `<span>${k ? `<kbd>${esc(t(k))}</kbd>` : ''}${esc(t(v))}</span>`).join('');
    // the dialog box and the ending card are redrawn too
    this.dlgKey = '';
    this.dlgSpeaker = '';
    if (this.ended) this.renderEnd();
  }

  /** queue a notification (same entry point the game events use) */
  toast(text: string, kind = 'info') {
    // (dev: translate now, so the missing-French check sees every toast, even ones never shown)
    if (import.meta.env.DEV && lang === 'fr') {
      if (kind === 'discover') t(text);
      else if (kind === 'quest') this.questEl(text);
      else if (kind !== 'item') t(text);
      else this.itemParts(text);
    }
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
    if (lang !== this.shownLang) this.relabel();

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

    // ---- belly-jump ring
    const segLen = (CIRC * (360 / SEG - GAP)) / 360;
    this.chiSegs.forEach((c, i) => {
      const f = Math.max(0, Math.min(1, (P.chi - i * (100 / SEG)) / (100 / SEG)));
      c.setAttribute('stroke-dasharray', `${segLen * f} ${CIRC}`);
    });
    const ready = P.chi >= Math.max(1, P.bellyCost);
    // Dragon Chonk: a golden portrait and the Dragon Belly
    if (this.player.classList.contains('dragon') !== g.dragon) {
      this.player.classList.toggle('dragon', g.dragon);
      this.bellyTag.innerHTML = `<kbd>K</kbd>${esc(t(g.dragon ? 'Dragon Belly' : 'Belly Jump'))}`;
    }
    this.flash.style.opacity = g.flash > 0.001 ? String(Math.min(1, g.flash * 1.2)) : '0';
    this.chiRing.classList.toggle('ready', ready);
    this.chiRing.classList.toggle('full', P.chi >= 99.9);
    this.bellyTag.classList.toggle('ready', ready);

    // ---- quest tracker: main quest first, the Dragon Noodles errand as a side quest
    const obj = g.objectives();
    let html = '', group = 'main';
    obj.forEach((o, i) => {
      const side = !!o.side;
      if (i === 0 || side) {
        group = side && !o.required ? 'side' : 'main';
        const label = t(o.required ? 'Needed Now' : side ? 'Side Quest' : o.done ? 'Complete' : 'Main Quest');
        const seal = side ? `<i class="seal seal-q ${o.required ? '' : 'jade'}">${o.side === 'training' ? '武' : '膳'}</i>` : '<i class="seal seal-q">任</i>';
        html += `<div class="q-head ${group}">${seal}<span>${label}</span></div>`;
        html += `<div class="q-title ${group} ${o.done ? 'done' : ''}">${esc(t(o.text))}</div>`;
      } else html += `<div class="q-sub ${o.done ? 'done' : ''}"><i></i>${esc(t(o.text))}</div>`;
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
    ].map(([k, n, name]) => `<span class="inv-i ${k}" title="${esc(t(String(name)))}">${icon(k as Icon)}<b>${n}</b></span>`).join('');
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
      // (French: O for ouest)
      if (k % 6 === 0) marks.push(`<div class="cm dir ${k === 0 ? 'north' : ''}" style="left:${x}%;opacity:${fade}">${(lang === 'fr' ? 'NESO' : 'NESW')[k / 6]}</div>`);
      else if (k % 3 === 0) marks.push(`<div class="cm mid" style="left:${x}%;opacity:${fade}">${(lang === 'fr' ? ['NE', 'SE', 'SO', 'NO'] : ['NE', 'SE', 'SW', 'NW'])[(k - 3) / 6]}</div>`);
      else marks.push(`<div class="cm tick" style="left:${x}%;opacity:${fade}"></div>`);
    }
    this.compassMarks.innerHTML = marks.join('');
    // objective markers: persistent elements (so their CSS pulse keeps running), jade gems with a distance
    // label; the primary objective pins to the edge with an arrow when it is behind you
    const targets = g.dialog ? [] : g.targets();
    let used = 0;
    targets.forEach((tg, i) => {
      const b = Math.atan2(tg.x - P.pos.x, tg.z - P.pos.z);
      const dist = Math.hypot(tg.x - P.pos.x, tg.z - P.pos.z);
      let d = rel(b);
      const lim = HALF * 0.9;
      const off = Math.abs(d) > lim;
      if (off && i > 0) return;
      d = Math.max(-lim, Math.min(lim, d));
      const m = this.targetEl(used++);
      m.el.style.left = `${xOf(d)}%`;
      m.el.className = `cm target${i === 0 ? ' primary' : ''}${off ? ` edge ${d > 0 ? 'left' : 'right'}` : ''}${i === 0 && Math.abs(rel(b)) < 0.3 ? ' center' : ''}${dist < 12 ? ' here' : ''}`;
      const ds = dist < 1000 ? `${Math.round(dist)} m` : `${num(dist / 1000, 1)} km`;
      if (m.dist.textContent !== ds) m.dist.textContent = ds;
      const name = t(tg.name);
      if (m.name.textContent !== name) m.name.textContent = name;
      m.arrow.textContent = d > 0 ? '‹' : '›';
      m.el.style.display = '';
    });
    for (let k = used; k < this.targetEls.length; k++) this.targetEls[k].el.style.display = 'none';

    // ---- training key hints
    const tut = g.tutorial();
    const tutHtml = tut
      ? `<div class="tut-label"><i class="seal seal-q jade">武</i><span>${t('Training')}</span></div>
        <div class="tut-keys">${tut.keys.map((k) => `<kbd class="${k.length > 1 ? 'wide' : ''}">${esc(t(k))}</kbd>`).join(tut.sep ? `<em>${esc(t(tut.sep))}</em>` : '')}</div>
        <div class="tut-text">${esc(t(tut.text))}${tut.count ? ` <b>${esc(tut.count)}</b>` : ''}</div>
        ${tut.progress !== undefined ? `<div class="tut-bar"><i style="width:${Math.round(tut.progress * 100)}%"></i></div>` : ''}`
      : '';
    if (tutHtml !== this.lastTut) {
      const step = tut ? `${tut.text}|${tut.keys.join()}` : '';
      const prev = this.tut.dataset.step ?? '';
      this.tut.innerHTML = tutHtml || this.tut.innerHTML;
      this.tut.classList.toggle('show', !!tut);
      if (tut && step !== prev) {
        this.tut.dataset.step = step;
        this.tut.classList.remove('fresh');
        void this.tut.offsetWidth;
        this.tut.classList.add('fresh');
      }
      this.lastTut = tutHtml;
    }

    // ---- interaction prompt
    const it = g.dialog ? null : g.interactable();
    this.prompt.classList.toggle('show', !!it);
    if (it && this.promptName.textContent !== t(it.name)) this.promptName.textContent = t(it.name);

    // ---- dialog with a typewriter
    if (g.dialog) {
      const line = g.dialog.lines[g.dialog.i];
      const text = t(line.text);
      const key = `${g.dialog.i}|${text}`;
      if (key !== this.dlgKey) {
        this.dlgKey = key;
        this.typed = 0;
        if (line.who !== this.dlgSpeaker) {
          this.dlgSpeaker = line.who;
          this.dlgPortrait.innerHTML = portraitHtml(line.who, g.npcs.find((n) => n.name === line.who)?.kind);
          this.dlgPortrait.classList.toggle('oracle', line.who === 'The Oracle');
          this.dlgWho.innerHTML = `<span>${esc(t(line.who))}</span><i></i>`;
          this.dialog.classList.remove('swap');
          void this.dialog.offsetWidth;
          this.dialog.classList.add('swap');
        }
      }
      this.typed = Math.min(text.length, this.typed + dt * 55);
      const n = Math.floor(this.typed);
      if (this.dlgText.dataset.n !== `${n}|${key}`) {
        this.dlgText.dataset.n = `${n}|${key}`;
        this.dlgText.innerHTML = `${esc(text.slice(0, n))}<span class="ghost">${esc(text.slice(n))}</span>`;
      }
      this.dlgNext.classList.toggle('ready', n >= text.length);
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

  private targetEl(i: number) {
    while (this.targetEls.length <= i) {
      const e = el('div', 'cm target', this.compassTargets, '<span class="tg-pulse"></span><i class="tg-gem"></i><em class="tg-arrow"></em><small><b class="tg-name"></b><span class="tg-dist"></span></small>');
      this.targetEls.push({ el: e, dist: e.querySelector('.tg-dist')!, name: e.querySelector('.tg-name')!, arrow: e.querySelector('.tg-arrow')! });
    }
    return this.targetEls[i];
  }

  // ------------------------------------------------------------------ notifications
  private tickNotes(dt: number) {
    // cinematic slot: one region reveal or quest banner at a time, shortened when others wait
    const s = this.stageCur;
    // a conversation starting mid-reveal: tuck the banner away and replay it afterwards
    if (s && this.game.dialog && s.t < s.dur && s.replay) {
      this.stageQ.unshift(s.replay);
      s.t = s.dur;
      s.replay = undefined;
    }
    if (s) {
      s.t += dt;
      const dur = this.stageQ.length ? Math.min(s.dur, 2.6) : s.dur;
      if (s.t > dur && !s.el.classList.contains('out')) s.el.classList.add('out');
      if (s.t > dur + 0.9) { s.el.remove(); this.stageCur = null; }
    }
    // region reveals and quest banners wait until the conversation is over (they'd cover the scene)
    if (!this.stageCur && this.stageQ.length && !this.game.dialog) {
      const n = this.stageQ.shift()!;
      const e = n.kind === 'discover' ? this.discoverEl(n.text) : this.questEl(n.text);
      this.stageLayer.appendChild(e);
      this.stageCur = { el: e, t: 0, dur: n.kind === 'discover' ? 4.4 : 4, replay: n };
    }

    const f = this.infoCur;
    if (f) {
      f.t += dt;
      const dur = this.infoQ.length ? Math.min(f.dur, 2) : f.dur;
      if (f.t > dur && !f.el.classList.contains('out')) f.el.classList.add('out');
      if (f.t > dur + 0.6) { f.el.remove(); this.infoCur = null; }
    }
    if (!this.infoCur && this.infoQ.length) {
      const e = el('div', 'info', this.infoLayer, `<i class="dot"></i>${esc(t(this.infoQ.shift()!))}`);
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
    e.innerHTML = `<div class="d-kicker">${first ? 'Chonk Fu' : esc(t('New Place'))}</div>
      <div class="d-name">${esc(t(name))}</div>${FLOURISH}<div class="d-hanzi">${hz}</div>`;
    return e;
  }

  private questEl(text: string) {
    const clean = text.replace(/\s+$/, '');
    let label = 'Quest Updated', seal = '进', title = clean, sub = '';
    const m = /^new quest:\s*/i.exec(clean);
    if (m) { label = 'New Quest'; seal = '任'; title = clean.slice(m[0].length); }
    else if (/^you got/i.test(clean)) { label = 'New Item'; seal = '宝'; title = clean.replace(/^you got\s*/i, '').replace(/!$/, ''); }
    else if (/^all five|^dragon noodles!|^training done/i.test(clean)) { label = 'Quest Complete'; seal = '成'; }
    if (!m) {
      const k = title.indexOf('! ');
      if (k > 0) { sub = title.slice(k + 2); title = title.slice(0, k); }
      title = title.replace(/!$/, '');
    }
    title = title.charAt(0).toUpperCase() + title.slice(1);
    // (parsed in English, then each part is translated)
    const e = document.createElement('div');
    e.className = `quest-banner ${seal === '成' ? 'complete' : ''}`;
    e.innerHTML = `<div class="qb-band"></div><i class="seal seal-stamp">${seal}</i>
      <div class="qb-text"><div class="qb-label">${esc(t(label))}</div><div class="qb-title">${esc(t(title))}</div>${sub ? `<div class="qb-sub">${esc(t(sub))}</div>` : ''}</div>`;
    return e;
  }

  /** an item feed line, parsed in English: "+1 Peach" (stacks), "Dumpling! +35 health", or a plain note */
  private itemParts(text: string): { key: string; name: string; n?: number; extra?: string; note?: boolean } {
    const plus = /^\+(\d+)\s+(.+)$/.exec(text);
    if (plus) return { key: plus[2], name: t(plus[2]), n: Number(plus[1]) };
    const m = /^(.+?)!\s*(.*)$/.exec(text);
    if (m && m[2]) return { key: text, name: t(m[1]), extra: t(m[2]) };
    return { key: text, name: t(text), note: true };
  }

  private pushItem(text: string) {
    const g = this.game;
    const ic = iconFor(text);
    const p = this.itemParts(text);
    if (p.n !== undefined) {
      // stack repeated pickups of the same thing into one line
      const live = this.feedItems.find((f) => f.key === p.key && f.t < 3.2);
      const count = ic === 'jade' ? g.jadeFound.size : ic === 'dumpling' ? 0 : g.inv[ic as 'peach' | 'shoot' | 'mushroom'] ?? 0;
      const amount = (live?.n ?? 0) + p.n;
      const html = `<span class="fi-ico">${icon(ic)}</span><span class="fi-name">${esc(p.name)}</span><b class="fi-plus">+${amount}</b>${count ? `<span class="fi-count">${count}</span>` : ''}`;
      if (live) {
        live.n = amount;
        live.t = 0;
        live.el.innerHTML = html;
        live.el.classList.remove('bump');
        void live.el.offsetWidth;
        live.el.classList.add('bump');
        return;
      }
      this.addFeed(html, p.key, amount);
    } else {
      const html = p.note
        ? `<span class="fi-ico">${icon(ic)}</span><span class="fi-name note">${esc(p.name)}</span>`
        : `<span class="fi-ico">${icon(ic)}</span><span class="fi-name">${esc(p.name)}</span><b class="fi-plus">${esc(p.extra!)}</b>`;
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
    this.renderEnd();
    this.end.classList.add('show');
    this.root.classList.add('ended');
  }

  private renderEnd() {
    const g = this.game;
    const mins = Math.floor(g.t / 60), secs = Math.floor(g.t % 60);
    const stat = (v: string, l: string) => `<div class="es"><b>${v}</b><span>${esc(t(l))}</span></div>`;
    this.end.innerHTML = `<div class="end-card">
      <div class="end-hanzi">功夫胖</div>
      <div class="end-kicker">${esc(t('You Did It!'))}</div>
      <div class="end-title">${esc(t('The Chonk Warrior'))}</div>
      ${FLOURISH}
      <p>${esc(t('The Oracle is awake. The Scroll is home. The noodles are hot!'))}</p>
      <div class="end-stats">${stat(`${mins}:${String(secs).padStart(2, '0')}`, 'Time')}${stat(String(g.stats.smashed), 'Smashed')}${stat(String(g.stats.items), 'Items')}${stat(String(g.stats.deaths), 'Falls')}</div>
      <button type="button">${esc(t('Play again'))}</button>
      <i class="seal seal-end">胖</i></div>`;
    this.end.querySelector('button')!.addEventListener('click', () => location.reload());
  }
}
