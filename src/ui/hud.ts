// DOM heads-up display: health + belly-bump bars, quest scroll, compass with objective markers,
// dialog box, interaction prompt, toasts, boss bar, inventory and the ending card.
import type { Game } from '../game/game';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
};

const PORTRAITS: Record<string, string> = {
  'Le Chonk': '#f3922a', 'Papa Canard': '#faf7f0', 'Master Tortue': '#9cc47a', 'The Oracle': '#3fd88a', Overfit: '#f0861f', Villager: '#f2a8a0',
};

export class Hud {
  private hp: HTMLElement;
  private hpText: HTMLElement;
  private belly: HTMLElement;
  private quest: HTMLElement;
  private inv: HTMLElement;
  private compass: HTMLElement;
  private compassMarks: HTMLElement;
  private dialog: HTMLElement;
  private dlgWho: HTMLElement;
  private dlgText: HTMLElement;
  private dlgDot: HTMLElement;
  private prompt: HTMLElement;
  private toasts: HTMLElement;
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private end: HTMLElement;
  private lastQuest = '';
  private typed = 0;
  private dlgKey = '';

  constructor(root: HTMLElement, private game: Game) {
    root.innerHTML = '';
    const left = el('div', 'hud-card hud-player', root);
    el('div', 'hud-face', left, faceSvg());
    const bars = el('div', 'hud-bars', left);
    el('div', 'hud-name', bars, 'LE CHONK');
    const hpBar = el('div', 'bar bar-hp', bars);
    this.hp = el('div', 'fill', hpBar);
    this.hpText = el('span', 'bar-text', hpBar);
    const bellyBar = el('div', 'bar bar-belly', bars);
    this.belly = el('div', 'fill', bellyBar);
    el('span', 'bar-text', bellyBar, 'BELLY BUMP · L');

    this.compass = el('div', 'compass', root);
    this.compassMarks = el('div', 'compass-strip', this.compass);
    el('div', 'compass-needle', this.compass);

    const q = el('div', 'hud-card hud-quest', root);
    el('div', 'quest-title', q, '📜 Quests');
    this.quest = el('div', 'quest-list', q);
    this.inv = el('div', 'inv', q);

    this.toasts = el('div', 'toasts', root);
    this.prompt = el('div', 'prompt', root);
    this.boss = el('div', 'boss', root);
    el('div', 'boss-name', this.boss, 'OVERFIT THE TIGER');
    const bb = el('div', 'bar bar-boss', this.boss);
    this.bossFill = el('div', 'fill', bb);

    this.dialog = el('div', 'dialog', root);
    this.dlgWho = el('div', 'dlg-who', this.dialog);
    this.dlgText = el('div', 'dlg-text', this.dialog);
    this.dlgDot = el('div', 'dlg-next', this.dialog, 'E ▸');

    el('div', 'help', root, '<b>Arrows</b> move · <b>Mouse</b> look · <b>Space</b> jump · <b>J</b>/click punch · <b>K</b> kick · <b>L</b> belly bump · <b>E</b> talk · <b>Shift</b> walk');
    this.end = el('div', 'end', root);
  }

  toast(text: string, kind = 'info') {
    const t = el('div', `toast toast-${kind}`, this.toasts, text);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  update(dt: number, camYaw: number) {
    const g = this.game, P = g.player;
    this.hp.style.width = `${(100 * P.hp) / P.maxHp}%`;
    this.hpText.textContent = `${Math.ceil(P.hp)} / ${P.maxHp}`;
    this.belly.style.width = `${P.chi}%`;
    this.belly.parentElement!.classList.toggle('ready', P.chi >= 99.9);

    // quests
    const obj = g.objectives();
    const html = obj.map((o, i) => `<div class="q ${o.done ? 'done' : ''} ${i === 0 ? 'main' : ''}">${o.done ? '✔' : i === 0 ? '◆' : '◇'} ${o.text}</div>`).join('');
    if (html !== this.lastQuest) {
      this.quest.innerHTML = html;
      this.lastQuest = html;
    }
    const inv = g.inv;
    this.inv.innerHTML = `<span title="Jade Stones">💎 ${g.jadeFound.size}/5</span><span title="Peaches">🍑 ${inv.peach}</span><span title="Bamboo shoots">🎋 ${inv.shoot}</span><span title="Mushrooms">🍄 ${inv.mushroom}</span>`;

    // compass: 120 degrees of view, camera heading at the center
    const heading = camYaw + Math.PI; // the direction the camera looks
    const marks: string[] = [];
    const place = (bearing: number, cls: string, label: string) => {
      let d = bearing - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > Math.PI / 3) return;
      // bearing increases clockwise seen from above; screen-right is clockwise
      marks.push(`<div class="cm ${cls}" style="left:${50 - (d / (Math.PI / 3)) * 50}%">${label}</div>`);
    };
    const dirs: [number, string][] = [[Math.PI, 'N'], [Math.PI / 2, 'E'], [0, 'S'], [-Math.PI / 2, 'W']];
    for (const [b, l] of dirs) place(b, 'dir', l);
    for (const t of g.targets()) {
      const b = Math.atan2(t.x - P.pos.x, t.z - P.pos.z);
      const dist = Math.hypot(t.x - P.pos.x, t.z - P.pos.z);
      place(b, 'target', `◆<small>${Math.round(dist)}m</small>`);
    }
    this.compassMarks.innerHTML = marks.join('');

    // interaction prompt
    const it = g.dialog ? null : g.interactable();
    this.prompt.style.display = it ? 'block' : 'none';
    if (it) this.prompt.innerHTML = `<b>E</b> Talk to ${it.name}`;

    // dialog with a typewriter
    if (g.dialog) {
      const line = g.dialog.lines[g.dialog.i];
      const key = `${g.dialog.i}|${line.text}`;
      if (key !== this.dlgKey) {
        this.dlgKey = key;
        this.typed = 0;
        this.dlgWho.textContent = line.who;
        this.dlgWho.style.setProperty('--who', PORTRAITS[line.who] ?? '#f2c23a');
      }
      this.typed = Math.min(line.text.length, this.typed + dt * 60);
      this.dlgText.textContent = line.text.slice(0, Math.floor(this.typed));
      this.dlgDot.style.opacity = this.typed >= line.text.length ? '1' : '0.3';
      this.dialog.classList.add('open');
    } else this.dialog.classList.remove('open');

    // boss
    const tiger = g.tiger;
    this.boss.style.display = tiger ? 'block' : 'none';
    if (tiger) this.bossFill.style.width = `${(100 * tiger.hp) / tiger.maxHp}%`;

    for (const ev of g.events) {
      if (ev.type === 'toast') this.toast(ev.text, ev.kind);
      if (ev.type === 'end') this.showEnd();
    }
  }

  private showEnd() {
    const g = this.game;
    const mins = Math.floor(g.t / 60), secs = Math.floor(g.t % 60);
    this.end.innerHTML = `<div class="end-card">
      <div class="end-title">THE CHONK WARRIOR</div>
      <p>The Oracle is awake, the Scroll is home, and the noodles are hot.</p>
      <div class="end-stats"><span>⏱ ${mins}m ${secs}s</span><span>💥 ${g.stats.smashed} smashed</span><span>🎁 ${g.stats.items} items</span><span>😵 ${g.stats.deaths} naps</span></div>
      <button onclick="location.reload()">Play again</button></div>`;
    this.end.classList.add('show');
  }
}

function faceSvg() {
  return `<svg viewBox="0 0 100 100" width="64" height="64">
    <polygon points="14,40 22,6 42,28" fill="#f3922a" stroke="#2b1d17" stroke-width="3"/>
    <polygon points="86,40 78,6 58,28" fill="#f3922a" stroke="#2b1d17" stroke-width="3"/>
    <ellipse cx="50" cy="56" rx="40" ry="34" fill="#f3922a" stroke="#2b1d17" stroke-width="3"/>
    <path d="M40 30 l2 12 M50 28 v13 M60 30 l-2 12" stroke="#b94f14" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="50" cy="70" rx="18" ry="13" fill="#fde3b8"/>
    <ellipse cx="36" cy="52" rx="9" ry="10" fill="#fff"/><ellipse cx="64" cy="52" rx="9" ry="10" fill="#fff"/>
    <ellipse cx="37" cy="53" rx="6" ry="7.5" fill="#f6c522"/><ellipse cx="63" cy="53" rx="6" ry="7.5" fill="#f6c522"/>
    <ellipse cx="37" cy="53" rx="2.4" ry="5" fill="#231a17"/><ellipse cx="63" cy="53" rx="2.4" ry="5" fill="#231a17"/>
    <ellipse cx="50" cy="64" rx="4.5" ry="3" fill="#e9818a"/>
    <path d="M44 71 q6 5 12 0" stroke="#3a1a12" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M26 42 l12 -3 M74 42 l-12 -3" stroke="#6a2c0c" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}
