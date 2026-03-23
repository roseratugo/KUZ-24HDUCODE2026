/**
 * DolphinManager — Dauphins qui sautent autour du bateau
 *
 * 6 dauphins nagent dans un rayon de 200 unites autour du bateau.
 * Chaque dauphin avance en ligne droite et fait des sauts paraboliques periodiques.
 *
 * Physique du saut :
 * - Arc parabolique : hauteur = 4 * t * (1-t) * jumpHeight (max au milieu)
 * - Pendant le saut : pitch (rotation X) simule le nez en l'air puis la plongee
 * - Hors du saut : le dauphin est legerement sous l'eau
 *
 * Quand un dauphin s'eloigne trop (>350u), il se teleporte a 80-180u du bateau
 * avec une direction qui pointe vers le bateau.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const DOLPHIN_SCALE = 8;
const DOLPHIN_COUNT = 6;
const SWIM_SPEED_MIN = 3;
const SWIM_SPEED_MAX = 6;
const SPAWN_RANGE = 200;
const RESPAWN_DISTANCE = 350;

export class DolphinManager {
  constructor(scene) {
    this.scene = scene;
    this.template = null;
    this.templateAnimations = null;
    this.dolphins = [];
    this.ready = false;
    this._templateMaxDim = 1;

    this._loadTemplate();
  }

  _loadTemplate() {
    const loader = new GLTFLoader();
    loader.load(
      "/models/dolphin/scene.gltf",
      (gltf) => {
        this.template = gltf.scene;
        this.templateAnimations = gltf.animations;

        const box = new THREE.Box3().setFromObject(this.template);
        const size = box.getSize(new THREE.Vector3());
        this._templateMaxDim = Math.max(size.x, size.y, size.z);

        this.ready = true;
        console.log(
          "[Dolphins] Template loaded, animations:",
          this.templateAnimations.length,
        );
      },
      undefined,
      (err) => console.warn("[Dolphins] Failed to load dolphin model:", err),
    );
  }

  spawn(centerX, centerZ) {
    if (!this.ready) return;

    this.clear();

    for (let i = 0; i < DOLPHIN_COUNT; i++) {
      const dolphinScene = SkeletonUtils.clone(this.template);
      const s = DOLPHIN_SCALE / this._templateMaxDim;
      dolphinScene.scale.setScalar(s);

      const group = new THREE.Group();
      group.add(dolphinScene);
      this.scene.add(group);

      let mixer = null;
      let action = null;
      if (this.templateAnimations.length > 0) {
        mixer = new THREE.AnimationMixer(dolphinScene);
        action = mixer.clipAction(this.templateAnimations[0]);
        action.timeScale = 3 + Math.random() * 2;
        action.time =
          Math.random() * (this.templateAnimations[0].duration || 1);
        action.play();
      }

      const angle0 = Math.random() * Math.PI * 2;
      const dist0 = 40 + Math.random() * SPAWN_RANGE;

      const heading = Math.random() * Math.PI * 2;

      const params = {
        x: centerX + Math.cos(angle0) * dist0,
        z: centerZ + Math.sin(angle0) * dist0,
        heading,
        speed:
          SWIM_SPEED_MIN + Math.random() * (SWIM_SPEED_MAX - SWIM_SPEED_MIN),
        jumpFreq: 0.12 + Math.random() * 0.08,
        jumpHeight: 5 + Math.random() * 4,
        jumpDuration: 1.0 + Math.random() * 0.5,
        jumpTimer: Math.random() * 20,
        waterY: -2,
        boatX: centerX,
        boatZ: centerZ,
      };

      this.dolphins.push({ mesh: group, mixer, action, params });
    }
  }

  clear() {
    for (const d of this.dolphins) {
      this.scene.remove(d.mesh);
      if (d.mixer) d.mixer.stopAllAction();
    }
    this.dolphins = [];
  }

  update(delta, elapsed) {
    for (const d of this.dolphins) {
      if (d.mixer) d.mixer.update(delta);

      const p = d.params;

      p.x += Math.sin(p.heading) * p.speed * delta;
      p.z += Math.cos(p.heading) * p.speed * delta;

      const dx = p.x - p.boatX;
      const dz = p.z - p.boatZ;
      if (dx * dx + dz * dz > RESPAWN_DISTANCE * RESPAWN_DISTANCE) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 100;
        p.x = p.boatX + Math.cos(angle) * dist;
        p.z = p.boatZ + Math.sin(angle) * dist;
        p.heading =
          Math.atan2(p.boatX - p.x, p.boatZ - p.z) +
          (Math.random() - 0.5) * 0.8;
        p.jumpTimer = Math.random() * 10;
      }

      p.jumpTimer += delta;
      const cycleDuration = 1 / p.jumpFreq;
      const timeInCycle = p.jumpTimer % cycleDuration;
      const jumpRatio = timeInCycle / cycleDuration;

      let y;
      const jumpWindow = p.jumpDuration / cycleDuration;
      if (jumpRatio < jumpWindow) {
        const t = jumpRatio / jumpWindow;
        const arc = 4 * t * (1 - t);
        y = p.waterY + arc * p.jumpHeight;
      } else {
        y = p.waterY - 2;
      }

      d.mesh.position.set(p.x, y, p.z);

      d.mesh.rotation.y = p.heading;

      if (jumpRatio < jumpWindow) {
        const t = jumpRatio / jumpWindow;
        d.mesh.rotation.x = (0.5 - t) * 1.5;
      } else {
        d.mesh.rotation.x = 0.15;
      }

      d.mesh.rotation.z = 0;
    }
  }
}
