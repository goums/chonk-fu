// CHONK FU demo video: 10 scenes, each as long as its voice-over line, over replays of real Mistral runs.
import React from 'react';
import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';
import { loadFont as loadCormorant } from '@remotion/google-fonts/CormorantGaramond';
import { loadFont as loadNunito } from '@remotion/google-fonts/NunitoSans';
import { loadFont as loadHanzi } from '@remotion/google-fonts/MaShanZheng';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import voice from './voice.json';
import gameTl from '../public/footage/game.timeline.json';
import panelTl from '../public/footage/panel.timeline.json';
import run2 from '../../public/runs/2026-10-21-21-19-mistral-large-4.json';

const CINZEL = loadCinzel('normal', { weights: ['600', '700'], subsets: ['latin'] }).fontFamily;
const SERIF = loadCormorant('normal', { weights: ['600'], subsets: ['latin'] }).fontFamily;
const SANS = loadNunito('normal', { weights: ['600', '700', '800'], subsets: ['latin'] }).fontFamily;
const HANZI = loadHanzi('normal', { weights: ['400'], subsets: ['chinese-simplified'] }).fontFamily;
const MONO = loadMono('normal', { weights: ['500', '700'], subsets: ['latin'] }).fontFamily;

export const FPS = 30;
// the game's HUD tokens (src/style.css), plus Mistral orange for the AI bits
const C = {
  ink: '#0b0d0c', panel: 'rgba(14, 16, 15, 0.92)', line: 'rgba(217, 181, 106, 0.45)',
  gold: '#d9b56a', goldHi: '#f4dc9c', goldLo: '#9c7a3c', jade: '#4fd39a', jadeHi: '#a6f5cf', jadeLo: '#1f7a55',
  cinnabar: '#c2402c', cinnabarHi: '#e2593e', paper: '#f3ead6', text: '#f4efe4', dim: 'rgba(244, 239, 228, 0.62)',
  orange: '#ff8205', orangeHi: '#ffb45e',
};
const SHADOW = '0 0 2px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.75), 0 0 16px rgba(0,0,0,0.5)';

type Line = { id: string; who: string; text: string; file: string; sec: number };
const V = Object.fromEntries((voice as Line[]).map((l) => [l.id, l])) as Record<string, Line>;
const LEAD = 0.4; // seconds of silence before each line
const len = (id: string, pad = 0.6, lead = LEAD) => Math.round((V[id].sec + lead + pad) * FPS);

// ---------------------------------------------------------------- footage: where things happen in the clips
type TL = { turns: { turn: number; t: number; sec: number }[]; lines: { who: string; text: string; sec: number }[] };
const GAME = 'footage/game.mp4', PANEL = 'footage/panel.mp4', POSE = 'footage/pose.mp4';
const turnAt = (tl: TL, turn: number, off = 0) => (tl.turns.find((x) => x.turn === turn)?.sec ?? 0) + off;
const lineAt = (tl: TL, start: string, off = 0) => (tl.lines.find((x) => x.text.startsWith(start))?.sec ?? 0) + off;
const G = gameTl as TL, P = panelTl as TL;

// ---------------------------------------------------------------- building blocks
const pop = (frame: number, fps: number, delay = 0) => spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 150 } });
const fadeIn = (f: number, d = 10) => interpolate(f, [0, d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

const Footage: React.FC<{ src: string; from: number; volume?: number; style?: React.CSSProperties; still?: boolean }> = ({ src, from, volume = 0.45, style, still }) => {
  const v = <OffthreadVideo src={staticFile(src)} startFrom={Math.round(from * FPS)} volume={still ? 0 : volume} muted={still} style={{ width: '100%', height: '100%', ...style }} />;
  return <AbsoluteFill style={{ background: '#000' }}>{still ? <Freeze frame={0}>{v}</Freeze> : v}</AbsoluteFill>;
};

/** cuts of footage, back to back; the last one fills the scene */
const Cuts: React.FC<{ cuts: { src: string; from: number; sec?: number; caption?: [string, string] }[]; volume?: number }> = ({ cuts, volume }) => {
  const { durationInFrames } = useVideoConfig();
  let t = 0;
  return (
    <>
      {cuts.map((c, i) => {
        const d = c.sec ? Math.round(c.sec * FPS) : durationInFrames - t;
        const s = (
          <Sequence key={i} from={t} durationInFrames={d}>
            <Footage src={c.src} from={c.from} volume={volume} />
            {c.caption && <Caption kicker={c.caption[0]} title={c.caption[1]} />}
          </Sequence>
        );
        t += d;
        return s;
      })}
    </>
  );
};

const Voice: React.FC<{ id: string; delay?: number }> = ({ id, delay = LEAD }) => (
  <Sequence from={Math.round(delay * FPS)} layout="none">
    <Audio src={staticFile(V[id].file)} volume={1} />
  </Sequence>
);

const Seal: React.FC<{ ch: string; size?: number; jade?: boolean; rot?: number; style?: React.CSSProperties }> = ({ ch, size = 40, jade, rot = 0, style }) => (
  <div style={{
    width: size, height: size, display: 'grid', placeItems: 'center', fontFamily: HANZI, fontSize: size * 0.74, lineHeight: 1, color: '#fff4ea', borderRadius: size * 0.08,
    background: jade ? `radial-gradient(circle at 35% 30%, #5fd6a0, ${C.jadeLo} 65%, #0f4a33)` : `radial-gradient(circle at 35% 30%, ${C.cinnabarHi}, ${C.cinnabar} 60%, #8f2618)`,
    boxShadow: '0 0 0 1px rgba(255,220,200,0.18) inset, 0 3px 10px rgba(0,0,0,0.45)', transform: `rotate(${rot}deg)`, ...style,
  }}>{ch}</div>
);

/** Mistral's pixel M (the game's icon) */
const MistralM: React.FC<{ size: number }> = ({ size }) => {
  const rows = ['X...X', 'XX.XX', 'XXXXX', 'X.X.X', 'X...X'];
  const colors = ['#ffd800', '#ffaf00', '#ff8205', '#fa500f', '#e10500'];
  return (
    <svg viewBox="0 0 15 15" width={size} height={size} shapeRendering="crispEdges" style={{ filter: 'drop-shadow(0 0 6px rgba(255,130,5,0.5))', flex: 'none' }}>
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === 'X' ? <rect key={`${x}-${y}`} x={x * 3} y={y * 3} width={3} height={3} fill={colors[y]} /> : null)))}
    </svg>
  );
};

/** a quest-banner style caption, bottom left */
const Caption: React.FC<{ kicker: string; title: string; delay?: number }> = ({ kicker, title, delay = 4 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = pop(f, fps, delay);
  return (
    <div style={{ position: 'absolute', left: 0, top: 640, padding: '26px 140px 30px 84px', background: 'linear-gradient(90deg, rgba(5,7,6,0.72), rgba(5,7,6,0.45) 60%, transparent)', opacity: interpolate(s, [0, 1], [0, 1]), transform: `translateX(${interpolate(s, [0, 1], [-60, 0])}px)` }}>
      <div style={{ fontFamily: CINZEL, fontWeight: 600, fontSize: 22, letterSpacing: '0.38em', textTransform: 'uppercase', color: C.gold, textShadow: SHADOW }}>{kicker}</div>
      <div style={{ width: 260, height: 1, margin: '10px 0 8px', background: `linear-gradient(90deg, ${C.gold}, transparent)` }} />
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 62, lineHeight: 1.05, color: C.text, textShadow: SHADOW }}>{title}</div>
    </div>
  );
};

/** the section heading on the harness / results scenes */
const Heading: React.FC<{ kicker: string; title: string; seal: string; x?: number; y?: number }> = ({ kicker, title, seal, x = 84, y = 64 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 22, opacity: fadeIn(f, 12) }}>
      <Seal ch={seal} size={64} rot={-6} />
      <div>
        <div style={{ fontFamily: CINZEL, fontWeight: 600, fontSize: 22, letterSpacing: '0.38em', color: C.gold, textShadow: SHADOW }}>{kicker}</div>
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 58, letterSpacing: '0.06em', color: C.text, textShadow: SHADOW, lineHeight: 1.1 }}>{title}</div>
      </div>
    </div>
  );
};

const Chip: React.FC<{ children: React.ReactNode; color?: string; delay?: number; style?: React.CSSProperties }> = ({ children, color = C.orange, delay = 0, style }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = pop(f, fps, delay);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontFamily: SANS, fontWeight: 800, fontSize: 30, color: C.text, padding: '12px 22px', background: C.panel, border: `1.5px solid ${color}`, borderRadius: 6, boxShadow: `0 0 22px ${color}55, 0 8px 24px rgba(0,0,0,0.5)`, transform: `scale(${s})`, opacity: Math.min(1, s * 2), ...style }}>{children}</div>
  );
};

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; accent?: string }> = ({ children, style, accent = C.line }) => (
  <div style={{ background: 'linear-gradient(180deg, rgba(14,16,15,0.94), rgba(8,10,9,0.9))', border: `1.5px solid ${accent}`, borderRadius: 6, boxShadow: '0 16px 50px rgba(0,0,0,0.55)', ...style }}>{children}</div>
);

// ---------------------------------------------------------------- scenes
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = pop(f, fps, 8), h = pop(f, fps, 20), sub = fadeIn(f - 34, 14);
  const out = interpolate(f, [3.0 * fps, 3.6 * fps], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      {/* blurred under the title (the game's own place banners would collide with it) */}
      <AbsoluteFill style={{ filter: `blur(${interpolate(f, [2.8 * fps, 3.6 * fps], [9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)` }}>
        <Cuts volume={0.4} cuts={[{ src: GAME, from: 0, sec: 3.6 }]} />
      </AbsoluteFill>
      {/* Le Chonk's face: the camera in front of him, closer */}
      <Sequence from={Math.round(3.6 * fps)} durationInFrames={Math.round(3.4 * fps)}>
        <AbsoluteFill style={{ transform: 'scale(1.6)', transformOrigin: '48% 60%' }}>
          <Footage src={POSE} from={0.8} volume={0.4} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={Math.round(7.0 * fps)}>
        <Footage src={GAME} from={68.0} volume={0.5} />
      </Sequence>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(5,7,6,0.35), rgba(5,7,6,0.75))', opacity: out * 0.9 + 0.1 }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', opacity: out }}>
        <Img src={staticFile('img/chonk.webp')} style={{ width: 170, height: 170, borderRadius: '50%', objectFit: 'cover', boxShadow: `0 0 0 3px ${C.gold}, 0 0 0 8px rgba(10,10,8,0.7), 0 0 0 10px rgba(217,181,106,0.45), 0 12px 40px rgba(0,0,0,0.6)`, transform: `scale(${pop(f, fps, 2)})` }} />
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 168, letterSpacing: '0.16em', paddingLeft: '0.16em', marginTop: 26, color: C.text, textShadow: `0 4px 30px rgba(0,0,0,0.7), 0 0 2px #000`, transform: `scale(${interpolate(t, [0, 1], [1.15, 1])})`, opacity: t, lineHeight: 1 }}>CHONK FU</div>
        <div style={{ fontFamily: HANZI, fontSize: 64, color: C.goldHi, letterSpacing: '0.3em', paddingLeft: '0.3em', marginTop: 14, opacity: h, textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>功夫胖</div>
        <div style={{ fontFamily: CINZEL, fontWeight: 600, fontSize: 28, letterSpacing: '0.36em', color: C.gold, marginTop: 24, opacity: sub, textShadow: SHADOW }}>A KUNG FU ADVENTURE STARRING LE CHONK</div>
      </AbsoluteFill>
      <Voice id="intro" delay={0.8} />
    </AbsoluteFill>
  );
};

const Valley: React.FC = () => (
  <AbsoluteFill>
    <Cuts cuts={[
      { src: GAME, from: lineAt(G, 'Chonk! Wolf bandits', -0.3), sec: 4.6, caption: ['Papa Canard', 'Wolf bandits!'] },
      { src: GAME, from: turnAt(G, 2, 0.2) },
    ]} />
    <Voice id="valley" />
  </AbsoluteFill>
);

// music only: a taste of the quest, no places named
const Montage: React.FC = () => (
  <AbsoluteFill>
    <Cuts volume={0.6} cuts={[
      { src: GAME, from: lineAt(G, 'The wolf bandits took', -0.5), sec: 1.9, caption: ['Master Tortue', 'Find the five Jade Stones'] },
      { src: GAME, from: 43.0, sec: 4.0 },
      { src: GAME, from: 62.8 },
    ]} />
  </AbsoluteFill>
);

const Overfit: React.FC = () => (
  <AbsoluteFill>
    <Cuts cuts={[
      { src: GAME, from: lineAt(G, 'Ha! I am OVERFIT', -0.25), sec: 3.0, caption: ['The boss', 'Overfit the tiger'] },
      { src: GAME, from: 99.2, caption: ['Overfit', 'Predicted!'] },
    ]} />
    <Voice id="overfit" />
  </AbsoluteFill>
);

const Dragon: React.FC = () => (
  <AbsoluteFill>
    <Cuts cuts={[
      { src: GAME, from: 117.9, sec: 3.4, caption: ['A secret power', 'Dragon Chonk?'] },
      { src: GAME, from: 126.0 },
    ]} />
    <Voice id="dragon" delay={0.8} />
  </AbsoluteFill>
);

// ---- the harness, over run 2 with the AI panel open
const OBS_TURN = 2;
const obsTurn = (run2 as { turns: { turn: number; obs: string; thought: string; action: { action: string; target?: string }; ms: number }[] }).turns[OBS_TURN - 1];
const OBS = obsTurn.obs;
const ObsCard: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = OBS.split('\n');
  const shown = Math.floor(interpolate(f, [12, 7 * fps], [0, lines.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const head = /^(QUEST|NEAR YOU|LAST ACTIONS|GAME|HEARD)/;
  return (
    <Card style={{ position: 'absolute', left: 84, top: 210, width: 820, padding: '22px 26px', opacity: fadeIn(f - 4, 10) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontFamily: CINZEL, fontWeight: 600, fontSize: 19, letterSpacing: '0.3em', color: C.gold }}>TURN {OBS_TURN} · WHAT MISTRAL READS</div>
      </div>
      <pre style={{ margin: 0, fontFamily: MONO, fontWeight: 500, fontSize: 22, lineHeight: 1.4, color: '#d9e6dc', whiteSpace: 'pre-wrap', minHeight: 560 }}>
        {lines.slice(0, shown).map((l, i) => <div key={i} style={{ color: head.test(l) ? C.goldHi : l.includes('crate-1') ? C.orangeHi : undefined, fontWeight: head.test(l) ? 700 : 500 }}>{l || ' '}</div>)}
      </pre>
    </Card>
  );
};

const Harness: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {/* the first turns play, then the world waits on the next one */}
      <Sequence durationInFrames={Math.round(turnAt(P, OBS_TURN, 0.05) * FPS)}>
        <Footage src={PANEL} from={0} volume={0.35} />
      </Sequence>
      <Sequence from={Math.round(turnAt(P, OBS_TURN, 0.05) * FPS)}>
        <Footage src={PANEL} from={turnAt(P, OBS_TURN, 0.05)} still />
      </Sequence>
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(5,7,6,0.7), rgba(5,7,6,0.25) 55%, transparent)' }} />
      <Heading kicker="MISTRAL PLAYS" title="The harness" seal="智" />
      <ObsCard />
      <div style={{ position: 'absolute', left: 1000, top: 230, display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start' }}>
        <Chip delay={5.6 * fps} color={C.orange}><MistralM size={28} /> Mistral Large 4</Chip>
        <Chip delay={9.0 * fps} color={C.gold}>~300 tokens per turn</Chip>
      </div>
      <Voice id="harness" />
    </AbsoluteFill>
  );
};

const ACT = `act({
  thought: "${obsTurn.thought}",
  action: "${obsTurn.action.action}",
  target: "${obsTurn.action.target}"
})`;
const ACTIONS = ['go', 'talk', 'hit', 'fight', 'sprint', 'wait'];
const Act: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const freeze = Math.round(4.6 * fps); // the world waits while Mistral thinks
  const chars = Math.floor(interpolate(f, [8, 3.6 * fps], [0, ACT.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const thinking = f < freeze;
  const secs = Math.min(obsTurn.ms / 1000, (f / freeze) * (obsTurn.ms / 1000));
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={freeze}>
        <Footage src={PANEL} from={turnAt(P, OBS_TURN, 0.05)} still style={{ filter: 'saturate(0.35) brightness(0.8)' }} />
      </Sequence>
      <Sequence from={freeze}>
        <Footage src={PANEL} from={turnAt(P, OBS_TURN, 0.05)} volume={0.6} />
      </Sequence>
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(5,7,6,0.72), rgba(5,7,6,0.2) 55%, transparent)' }} />
      <Heading kicker="MISTRAL PLAYS" title="One action per turn" seal="智" />
      <Card accent={thinking ? C.orange : C.line} style={{ position: 'absolute', left: 84, top: 230, width: 860, padding: '26px 30px' }}>
        <pre style={{ margin: 0, fontFamily: MONO, fontWeight: 500, fontSize: 27, lineHeight: 1.5, color: C.jadeHi, whiteSpace: 'pre-wrap' }}>
          {ACT.slice(0, chars)}<span style={{ opacity: thinking && Math.floor(f / 8) % 2 ? 1 : 0, color: C.orange }}>▌</span>
        </pre>
      </Card>
      <div style={{ position: 'absolute', left: 84, top: 560, display: 'flex', gap: 14 }}>
        {ACTIONS.map((a, i) => (
          <Chip key={a} delay={1.2 * fps + i * 4} color={a === obsTurn.action.action ? C.orange : C.line} style={{ fontFamily: MONO, fontSize: 28, padding: '8px 18px', color: a === obsTurn.action.action ? C.orangeHi : C.text }}>{a}</Chip>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 84, top: 660, fontFamily: SANS, fontWeight: 700, fontSize: 30, color: C.paper, opacity: fadeIn(f - 3.5 * fps, 12), textShadow: SHADOW }}>
        The game walks, aims and times the keys.
      </div>
      <div style={{ position: 'absolute', left: 84, top: 760 }}>
        {thinking
          ? <Chip color={C.orange} style={{ fontSize: 34 }}>⏸ The world waits · Mistral thinks… {secs.toFixed(1)} s</Chip>
          : <Chip color={C.jade} style={{ fontSize: 34 }}>▶ {obsTurn.action.action} {obsTurn.action.target}</Chip>}
      </div>
      <Voice id="act" />
    </AbsoluteFill>
  );
};

const Replay: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Footage src={PANEL} from={turnAt(P, OBS_TURN, 0.05) + (len('act', 0.6) - Math.round(4.6 * FPS)) / FPS} volume={0.6} />
      <div style={{ position: 'absolute', left: 84, top: 210, display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start' }}>
        <Chip color={C.orange} delay={4}><MistralM size={28} /> Real thoughts · real run</Chip>
        <Chip color={C.jade} delay={2.4 * fps}>Deterministic: every run replays exactly</Chip>
      </div>
      <Voice id="replay" />
    </AbsoluteFill>
  );
};

const RUNS = [
  { name: 'Run 1', time: '6:33', turns: 55, cost: 0.049 },
  { name: 'Run 2', time: '5:26', turns: 49, cost: 0.043 },
  { name: 'Run 3', time: '5:06', turns: 44, cost: 0.039 },
];
const Results: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Footage src={GAME} from={86} volume={0} style={{ filter: 'blur(14px) brightness(0.45)' }} />
      <Heading kicker="MISTRAL LARGE 4 · NO REASONING" title="Three runs, three wins" seal="胜" x={160} y={110} />
      <div style={{ position: 'absolute', left: 160, right: 160, top: 330, display: 'flex', gap: 40 }}>
        {RUNS.map((r, i) => {
          const s = pop(f, fps, 10 + i * 7);
          return (
            <Card key={r.name} accent={C.jade} style={{ flex: 1, padding: '30px 34px', transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`, opacity: s }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 34, color: C.goldHi, letterSpacing: '0.12em' }}>{r.name.toUpperCase()}</div>
                <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 22, color: C.jadeHi, letterSpacing: '0.06em' }}>✓ QUEST COMPLETE</div>
              </div>
              <div style={{ height: 1, background: `linear-gradient(90deg, ${C.gold}, transparent)`, margin: '18px 0 22px' }} />
              {[[r.time, 'game time'], [String(r.turns), 'turns'], [`$${r.cost.toFixed(3)}`, 'cost']].map(([v, l], j) => (
                <div key={l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: j ? 10 : 0 }}>
                  <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 24, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{l}</span>
                  <span style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 54, color: j === 2 ? C.orangeHi : C.text }}>{v}</span>
                </div>
              ))}
            </Card>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 800, display: 'flex', justifyContent: 'center', gap: 22 }}>
        <Chip color={C.gold} delay={2.2 * fps}>~300 tokens per turn</Chip>
        <Chip color={C.gold} delay={2.6 * fps}>~5 s per turn</Chip>
        <Chip color={C.orange} delay={3.0 * fps}>4 to 5 cents a game</Chip>
      </div>
      <Voice id="results" />
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const glow = 0.5 + 0.5 * Math.sin((f / fps) * Math.PI * 1.25);
  const b = pop(f, fps, 14);
  return (
    <AbsoluteFill>
      <Footage src={GAME} from={0.3} volume={0} style={{ filter: 'blur(12px) brightness(0.42)' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 34, transform: `scale(${pop(f, fps, 2)})` }}>
          <Img src={staticFile('img/chonk.webp')} style={{ width: 150, height: 150, borderRadius: '50%', objectFit: 'cover', boxShadow: `0 0 0 3px ${C.gold}, 0 0 0 8px rgba(10,10,8,0.7), 0 12px 40px rgba(0,0,0,0.6)` }} />
          <div>
            <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 130, letterSpacing: '0.14em', color: C.text, lineHeight: 1, textShadow: '0 4px 30px rgba(0,0,0,0.7)' }}>CHONK FU</div>
            <div style={{ fontFamily: HANZI, fontSize: 52, color: C.goldHi, letterSpacing: '0.3em', marginTop: 8 }}>功夫胖</div>
          </div>
        </div>
        {/* the game's own button, bottom right of the screen, made big */}
        <div style={{
          marginTop: 70, display: 'inline-flex', alignItems: 'center', gap: 26, padding: '26px 46px 26px 40px', transform: `scale(${b})`,
          fontFamily: CINZEL, fontWeight: 600, fontSize: 46, letterSpacing: '0.22em', textTransform: 'uppercase', color: C.goldHi,
          background: 'rgba(5,7,6,0.75)', border: '2px solid #ffb45e', borderRadius: 4,
          boxShadow: `0 0 ${16 + 40 * glow}px rgba(255,130,5,${0.35 + 0.5 * glow}), 0 0 10px rgba(255,216,0,${0.6 * glow}) inset`,
        }}>
          <MistralM size={54} /> Let Chonk play
        </div>
        <div style={{ marginTop: 64, fontFamily: SANS, fontWeight: 800, fontSize: 54, color: C.orangeHi, opacity: fadeIn(f - 26, 12), textShadow: SHADOW }}>goums.github.io/chonk-fu</div>
        <div style={{ marginTop: 14, fontFamily: SANS, fontWeight: 700, fontSize: 32, color: C.dim, opacity: fadeIn(f - 34, 12) }}>github.com/goums/chonk-fu · made for Mistral’s Le Chonk challenge</div>
      </AbsoluteFill>
      <Voice id="outro" delay={0.6} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- timeline
const SCENES: { id: string; C: React.FC; frames: number; voice?: string; delay: number }[] = [
  { id: 'intro', C: Intro, frames: Math.round(8.6 * FPS), voice: 'intro', delay: 0.8 },
  { id: 'valley', C: Valley, frames: len('valley', 3.6), voice: 'valley', delay: LEAD },
  { id: 'montage', C: Montage, frames: Math.round(10.6 * FPS), delay: 0 },
  { id: 'overfit', C: Overfit, frames: len('overfit', 2.4), voice: 'overfit', delay: LEAD },
  { id: 'dragon', C: Dragon, frames: len('dragon', 3.8, 0.8), voice: 'dragon', delay: 0.8 },
  { id: 'harness', C: Harness, frames: len('harness', 0.4), voice: 'harness', delay: LEAD },
  { id: 'act', C: Act, frames: len('act', 0.6), voice: 'act', delay: LEAD },
  { id: 'replay', C: Replay, frames: len('replay', 1.2), voice: 'replay', delay: LEAD },
  { id: 'results', C: Results, frames: len('results', 1.6), voice: 'results', delay: LEAD },
  { id: 'outro', C: Outro, frames: len('outro', 3.0, 0.6), voice: 'outro', delay: 0.6 },
];
const START: Record<string, number> = {};
{
  let t = 0;
  for (const s of SCENES) {
    START[s.id] = t;
    t += s.frames;
  }
}
export const totalFrames = SCENES.reduce((a, s) => a + s.frames, 0);
export const sceneStarts = START;

// voice intervals (frames), for ducking the music under speech
const SPEECH = SCENES.filter((s) => s.voice).map((s) => [START[s.id] + Math.round(s.delay * FPS), START[s.id] + Math.round((s.delay + V[s.voice!].sec) * FPS)]);
const speaking = (fr: number) => {
  let d = Infinity;
  for (const [a, b] of SPEECH) d = Math.min(d, fr < a ? a - fr : fr > b ? fr - b : 0);
  return interpolate(d, [0, 12], [1, 0], { extrapolateRight: 'clamp' });
};

// the game's own score, one mood per part, crossfaded, ducked under the voice
const BEDS: { track: string; from: string; to: string; level: number }[] = [
  { track: 'village', from: 'intro', to: 'overfit', level: 0.55 },
  { track: 'combat', from: 'overfit', to: 'harness', level: 0.42 },
  { track: 'palace', from: 'harness', to: 'results', level: 0.5 },
  { track: 'ending', from: 'results', to: 'end', level: 0.5 },
];
const XF = 18;
const Beds: React.FC = () => (
  <>
    {BEDS.map((b) => {
      const a = START[b.from], z = b.to === 'end' ? totalFrames : START[b.to];
      const from = Math.max(0, a - (a ? XF : 0)), dur = z - from + (b.to === 'end' ? 0 : XF);
      return (
        <Sequence key={b.track} from={from} durationInFrames={dur} layout="none">
          <Audio src={staticFile(`music/${b.track}.mp3`)} volume={(fr) => {
            const g = from + fr;
            const edge = Math.min(1, fr / XF, (dur - fr) / (b.to === 'end' ? 45 : XF));
            return b.level * Math.max(0, edge) * (1 - 0.55 * speaking(g));
          }} />
        </Sequence>
      );
    })}
  </>
);

export const ChonkFu: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink }}>
    {SCENES.map(({ id, C: Scene, frames }) => (
      <Sequence key={id} from={START[id]} durationInFrames={frames}>
        <Scene />
      </Sequence>
    ))}
    <Beds />
  </AbsoluteFill>
);
