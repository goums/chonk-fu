// Third-person orbit camera that follows Le Chonk, never dips under the terrain, and auto-trails
// behind him when he runs. It orbits only while the player drags with a mouse button held (input.ts).
import * as THREE from 'three';
import { angleDelta, clamp, damp } from '../core/math';
import { heightAt } from '../world/terrain';
import { setOcclusionFocus } from '../world/kit';
import { CAMERA_SOLID, pointBlocked } from './colliders';

export class FollowCamera {
  yaw = Math.PI; // camera sits at target + (sin yaw, ., cos yaw) * dist
  pitch = 0.32;
  dist = 7.5;
  private target = new THREE.Vector3();
  private idle = 0;
  private reach = 7.5;

  constructor(public camera: THREE.PerspectiveCamera) {}

  private pull = 0;
  /** extra pitch from rising ground behind the camera (eased) */
  private lift = 0;
  /** seconds to hold a collision pull-in before easing back out */
  private hold = 0;
  private dir = new THREE.Vector3();
  private focusPt = new THREE.Vector3();

  /** is the orbit at this pitch and distance clear of the terrain? */
  private terrainClear(pitch: number, dist: number) {
    const cp = Math.cos(pitch), sx = Math.sin(this.yaw) * cp, sy = Math.sin(pitch), sz = Math.cos(this.yaw) * cp;
    for (let d = 1; ; d = Math.min(dist, d + 0.6)) {
      const px = this.target.x + sx * d, py = this.target.y + sy * d, pz = this.target.z + sz * d;
      if (py < heightAt(px, pz) + 0.45) return false;
      if (d >= dist) return true;
    }
  }
  /** dialog shot state: which side of the conversation line the camera stays on (180° rule) */
  private shotSide = 0;
  private inShot = false;
  private shotPos = new THREE.Vector3();
  private shotLook = new THREE.Vector3();
  private shotKey = -1;
  private shotPick = 0;

  /**
   * Conversation framing: shot / reverse shot over the listener's shoulder toward whoever speaks,
   * both characters in frame, eased in and out. a = Le Chonk, b = the person he talks to.
   */
  dialogShot(dt: number, a: THREE.Vector3, aHead: number, b: THREE.Vector3, bHead: number, aSpeaks: boolean) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.max(0.8, Math.hypot(dx, dz));
    const ux = dx / L, uz = dz / L; // a -> b
    const nx = -uz, nz = ux; // perpendicular
    const cam = this.camera.position;
    if (!this.inShot) {
      // keep the side the camera is already on, so the cut feels natural
      this.shotSide = (cam.x - a.x) * nx + (cam.z - a.z) * nz >= 0 ? 1 : -1;
      this.shotPos.copy(cam);
      this.shotLook.copy(this.target);
      this.shotKey = -1;
      this.inShot = true;
    }
    const speaker = aSpeaks ? a : b, listener = aSpeaks ? b : a;
    const sHead = aSpeaks ? aHead : bHead, lHead = aSpeaks ? bHead : aHead;
    const sx = aSpeaks ? ux : -ux, sz = aSpeaks ? uz : -uz; // speaker -> listener
    // look between the speaker's face and the midpoint, so both stay in frame
    const look = new THREE.Vector3(
      speaker.x * 0.6 + listener.x * 0.4,
      speaker.y + sHead * 0.72,
      speaker.z * 0.6 + listener.z * 0.4,
    );
    // candidate framings, best first: a profile two-shot angled a little toward the speaker (both faces
    // visible, on our side of the line, then the other side), then over-the-listener's-shoulder shots,
    // then a higher close shot; the first with a clear view wins
    const eye = Math.max(a.y, b.y) + Math.max(lHead, sHead) * 0.72 + 0.15;
    const Lf = Math.max(L, 1.4); // framing distance never collapses when they stand close
    const mid = new THREE.Vector3((a.x + b.x) / 2, eye, (a.z + b.z) / 2);
    const cands: THREE.Vector3[] = [];
    const away = 2.4 + Lf * 0.9;
    for (const side of [this.shotSide, -this.shotSide])
      cands.push(new THREE.Vector3(mid.x + nx * side * away + sx * 0.55 * Lf, eye, mid.z + nz * side * away + sz * 0.55 * Lf));
    const back = 2.3 + Lf * 0.35, off = 1.7 + Lf * 0.3;
    for (const side of [this.shotSide, -this.shotSide])
      cands.push(new THREE.Vector3(listener.x + sx * back + nx * side * off, eye + 0.2, listener.z + sz * back + nz * side * off));
    cands.push(new THREE.Vector3(mid.x + nx * this.shotSide * 2.2, eye + 1.6, mid.z + nz * this.shotSide * 2.2));
    const clear = (p: THREE.Vector3) => {
      // the camera needs elbow room (nothing right in front of the lens), not just a clear line
      if (pointBlocked(p.x, p.y, p.z, 1.3) || pointBlocked(p.x, p.y - 1.2, p.z, 1.3)) return false;
      const d = p.clone().sub(look), n = Math.ceil(d.length() / 0.4);
      for (let i = 1; i < n; i++) {
        const q = look.clone().addScaledVector(d, i / n);
        if (pointBlocked(q.x, q.y, q.z, i < n * 0.5 ? 0.6 : 0.3) || q.y < heightAt(q.x, q.z) + 0.2) return false;
      }
      return true;
    };
    // re-pick only when the speaker changes (or the current pick got blocked), so the shot holds still
    const key = aSpeaks ? 1 : 0;
    if (key !== this.shotKey || !clear(cands[this.shotPick] ?? cands[0])) {
      this.shotKey = key;
      this.shotPick = Math.max(0, cands.findIndex(clear));
    }
    const want = cands[this.shotPick] ?? cands[0];
    const ground = heightAt(want.x, want.z) + 0.5;
    if (want.y < ground) want.y = ground;
    this.shotPos.x = damp(this.shotPos.x, want.x, 3.5, dt);
    this.shotPos.y = damp(this.shotPos.y, want.y, 3.5, dt);
    this.shotPos.z = damp(this.shotPos.z, want.z, 3.5, dt);
    this.shotLook.x = damp(this.shotLook.x, look.x, 4.5, dt);
    this.shotLook.y = damp(this.shotLook.y, look.y, 4.5, dt);
    this.shotLook.z = damp(this.shotLook.z, look.z, 4.5, dt);
    cam.copy(this.shotPos);
    this.camera.lookAt(this.shotLook);
    // leave the orbit camera where the shot ends, so returning to play does not snap
    this.target.copy(a).setY(a.y + 1.5);
    const rel = cam.clone().sub(this.target);
    this.yaw = Math.atan2(rel.x, rel.z);
    this.reach = Math.min(this.dist, rel.length());
    // keep the see-through capsule on Le Chonk during the shot too (rendering only; framing unchanged)
    setOcclusionFocus(cam, this.focusPt.set(a.x, a.y + 1.0, a.z));
  }

  update(dt: number, focus: THREE.Vector3, heading: number, moving: boolean, look: { dx: number; dy: number; wheel: number; held?: boolean }, vel?: THREE.Vector3) {
    this.inShot = false;
    // a drag in progress (even a still one) keeps the camera where the player put it
    if (look.dx || look.dy || look.held) this.idle = 0;
    else this.idle += dt;
    this.yaw -= look.dx * 0.004;
    this.pitch = clamp(this.pitch + look.dy * 0.003, -0.15, 1.2);
    this.dist = clamp(this.dist + look.wheel * 0.8, 3.5, 22);
    look.dx = look.dy = look.wheel = 0;

    // swing behind the hero while running, after a short delay without mouse input
    if (moving && this.idle > 1.2) {
      const behind = heading + Math.PI;
      this.yaw += angleDelta(this.yaw, behind) * (1 - Math.exp(-1.2 * dt));
    }

    // look a little ahead of where the hero runs, follow softly, pull back a bit at speed
    const ax = vel ? vel.x * 0.3 : 0, az = vel ? vel.z * 0.3 : 0;
    const speed = vel ? Math.hypot(vel.x, vel.z) : 0;
    this.pull = damp(this.pull, Math.min(1, speed / 8) * 0.12, 3, dt);
    this.target.x = damp(this.target.x, focus.x + ax, 7, dt);
    this.target.y = damp(this.target.y, focus.y + 1.5, 4, dt);
    this.target.z = damp(this.target.z, focus.z + az, 7, dt);
    if (this.target.distanceTo(focus) > 20) this.target.copy(focus).setY(focus.y + 1.5);

    const full = this.dist * (1 + this.pull);
    // rising ground behind the camera: tilt the orbit up a little (bounded, eased) rather than diving in
    let lift = 0;
    while (lift < 0.45 && !this.terrainClear(this.pitch + lift, full)) lift += 0.075;
    this.lift = damp(this.lift, lift, lift > this.lift ? 3 : 1.2, dt);
    const pitch = Math.min(1.3, this.pitch + this.lift);
    const cp = Math.cos(pitch);
    const dir = this.dir.set(Math.sin(this.yaw) * cp, Math.sin(pitch), Math.cos(this.yaw) * cp);

    // pull in only in front of solid architecture and rocks (and ground the lift could not clear);
    // trees, bamboo and props in the way dissolve instead (see-through cut-out in their materials)
    let reach = full;
    for (let d = 0.8; d < full; d += 0.35) {
      const px = this.target.x + dir.x * d, py = this.target.y + dir.y * d, pz = this.target.z + dir.z * d;
      if (pointBlocked(px, py, pz, 0.9, CAMERA_SOLID) || py < heightAt(px, pz) + 0.3) {
        reach = Math.max(1.2, d - 0.5);
        break;
      }
    }
    // ease in quickly, hold, then ease back out slowly: no snapping, no flicker at a wall's edge
    if (reach < this.reach - 0.02) {
      this.reach = damp(this.reach, reach, 9, dt);
      this.hold = 0.45;
    } else if ((this.hold -= dt) <= 0) this.reach = damp(this.reach, reach, 1.6, dt);
    else this.reach = Math.min(this.reach, full);

    const cam = this.camera.position;
    cam.copy(this.target).addScaledVector(dir, this.reach);
    const ground = heightAt(cam.x, cam.z) + 0.6;
    if (cam.y < ground) cam.y = ground;
    setOcclusionFocus(cam, this.focusPt.set(focus.x, focus.y + 1.0, focus.z));
    this.camera.lookAt(this.target);
  }
}
