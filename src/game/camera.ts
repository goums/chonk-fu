// Third-person orbit camera that follows Le Chonk, never dips under the terrain, and auto-trails
// behind him when he runs.
import * as THREE from 'three';
import { angleDelta, clamp, damp } from '../core/math';
import { heightAt } from '../world/terrain';
import { pointBlocked } from './colliders';

export class FollowCamera {
  yaw = Math.PI; // camera sits at target + (sin yaw, ., cos yaw) * dist
  pitch = 0.32;
  dist = 7.5;
  private target = new THREE.Vector3();
  private idle = 0;
  private reach = 7.5;

  constructor(public camera: THREE.PerspectiveCamera) {}

  update(dt: number, focus: THREE.Vector3, heading: number, moving: boolean, look: { dx: number; dy: number; wheel: number }) {
    if (look.dx || look.dy) this.idle = 0;
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

    this.target.x = damp(this.target.x, focus.x, 12, dt);
    this.target.y = damp(this.target.y, focus.y + 1.5, 8, dt);
    this.target.z = damp(this.target.z, focus.z, 12, dt);
    if (this.target.distanceTo(focus) > 20) this.target.copy(focus).setY(focus.y + 1.5);

    const cp = Math.cos(this.pitch);
    const cam = this.camera.position;
    cam.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // pull in front of walls between the hero and the camera
    const dir = cam.clone().sub(this.target);
    const full = dir.length();
    dir.divideScalar(full);
    let reach = full;
    for (let d = 1; d < full; d += 0.5) {
      const px = this.target.x + dir.x * d, py = this.target.y + dir.y * d, pz = this.target.z + dir.z * d;
      if (pointBlocked(px, py, pz) || py < heightAt(px, pz) + 0.3) {
        reach = Math.max(1.2, d - 0.6);
        break;
      }
    }
    this.reach = reach < this.reach ? reach : damp(this.reach, reach, 3, dt);
    cam.copy(this.target).addScaledVector(dir, this.reach);
    const ground = heightAt(cam.x, cam.z) + 0.6;
    if (cam.y < ground) cam.y = ground;
    this.camera.lookAt(this.target);
  }
}
