// A scripted player that follows the quest with the same high-level actions as the model.
// It tests the skills (paths, fights, dialogs) for free, before spending tokens.
import { Breakable, FruitTree, Pickup } from '../game/entities';
import type { Game } from '../game/game';
import type { Action } from './skills';

export function scriptedAction(g: Game): Action {
  const P = g.player.pos;
  const near = (x: number, z: number) => g.entities.filter((e) => e.alive && Math.hypot(e.x - x, e.z - z) < 4);
  const ingredientAction = (): Action | null => {
    for (const k of ['peach', 'shoot', 'mushroom'] as const) {
      if (g.inv[k] >= 3) continue;
      const n = g.nearestIngredient(k);
      if (!n) continue;
      const e = near(n.x, n.z).find((x) => (x instanceof Pickup && x.item === k) || x instanceof FruitTree || (x instanceof Breakable && x.contents === k));
      if (!e) continue;
      return e instanceof Pickup ? { action: 'go', target: e.id } : { action: 'hit', target: e.id };
    }
    return null;
  };
  // wolves on Le Chonk: deal with them first
  const threat = g.enemies.some((e) => e.alive && !e.ko && e.kind === 'wolf' && Math.hypot(e.pos.x - P.x, e.pos.z - P.z) < 16 && (e.state === 'chase' || e.state === 'fight'));
  if (threat) return { action: 'fight' };
  switch (g.stage) {
    case 'intro':
    case 'canard2':
    case 'feast':
      return { action: 'talk', target: 'canard' };
    case 'crates': {
      const c = g.entities.find((e) => e.id.startsWith('crate-') && e.alive);
      return c ? { action: 'hit', target: c.id } : { action: 'wait' };
    }
    case 'tortue':
    case 'scroll':
      return { action: 'talk', target: 'tortue' };
    case 'stones': {
      const f = g.jadeFound;
      const loose = g.entities.find((e) => e instanceof Pickup && e.alive && e.item === 'jade');
      if (loose) return { action: 'go', target: loose.id };
      if (!f.has('jade-pond')) return { action: 'go', target: 'jade-pond' };
      if (!f.has('palace-vase')) {
        const v = g.entities.find((e) => e.id.startsWith('palace-vase') && e.alive && (e as Breakable).contents === 'jade');
        if (v) return { action: 'hit', target: v.id };
      }
      if (!f.has('oldtree')) return { action: 'hit', target: 'oldtree' };
      if (!f.has('boulder')) {
        const guards = g.enemies.some((e) => e.camp === 'forest' && e.alive && !e.ko);
        if (guards) return Math.hypot(P.x - 168, P.z - 34) > 14 ? { action: 'go', target: '160,34' } : { action: 'fight' };
        return { action: 'hit', target: 'boulder', move: 'belly' };
      }
      if (!f.has('chest')) {
        const wolves = g.enemies.some((e) => e.camp === 'camp' && e.alive && !e.ko);
        if (wolves) return Math.hypot(P.x - 132, P.z + 112) > 20 ? { action: 'go', target: 'camp' } : { action: 'fight' };
        return { action: 'hit', target: 'chest' };
      }
      return { action: 'wait' };
    }
    case 'oracle':
      return { action: 'talk', target: 'oracle' };
    case 'boss': {
      if (g.dragon) return { action: 'fight', target: 'overfit' };
      if (!g.noodleHint) return { action: 'fight', target: 'overfit' };
      if (g.inv.peach >= 3 && g.inv.shoot >= 3 && g.inv.mushroom >= 3) return { action: 'talk', target: 'canard' };
      return ingredientAction() ?? { action: 'wait' };
    }
    default:
      return { action: 'wait' };
  }
}
