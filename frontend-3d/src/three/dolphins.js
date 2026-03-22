import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const DOLPHIN_SCALE = 8;
const DOLPHIN_COUNT = 6;
const SWIM_SPEED_MIN = 3;
const SWIM_SPEED_MAX = 6;
const SPAWN_RANGE = 200;
const RESPAWN_DISTANCE = 350; // respawn when too far from boat

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

  /**
   * Spawn dolphins around a given world position (the boat).
   */
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

      // Animation
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

      // Random start position near boat
      const angle0 = Math.random() * Math.PI * 2;
      const dist0 = 40 + Math.random() * SPAWN_RANGE;

      // Random swim direction (straight line)
      const heading = Math.random() * Math.PI * 2;

      const params = {
        // Current position
        x: centerX + Math.cos(angle0) * dist0,
        z: centerZ + Math.sin(angle0) * dist0,
        heading,
        speed:
          SWIM_SPEED_MIN + Math.random() * (SWIM_SPEED_MAX - SWIM_SPEED_MIN),
        // Jump parameters
        jumpFreq: 0.12 + Math.random() * 0.08,
        jumpHeight: 5 + Math.random() * 4,
        jumpDuration: 1.0 + Math.random() * 0.5,
        jumpTimer: Math.random() * 20,
        waterY: -2,
        // Reference to boat center for respawn
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

      // Move straight forward
      p.x += Math.sin(p.heading) * p.speed * delta;
      p.z += Math.cos(p.heading) * p.speed * delta;

      // Respawn if too far from boat
      const dx = p.x - p.boatX;
      const dz = p.z - p.boatZ;
      if (dx * dx + dz * dz > RESPAWN_DISTANCE * RESPAWN_DISTANCE) {
        // Respawn on the opposite side, swimming inward
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 100;
        p.x = p.boatX + Math.cos(angle) * dist;
        p.z = p.boatZ + Math.sin(angle) * dist;
        p.heading =
          Math.atan2(p.boatX - p.x, p.boatZ - p.z) +
          (Math.random() - 0.5) * 0.8;
        p.jumpTimer = Math.random() * 10;
      }

      // Periodic jumping arc
      p.jumpTimer += delta;
      const cycleDuration = 1 / p.jumpFreq;
      const timeInCycle = p.jumpTimer % cycleDuration;
      const jumpRatio = timeInCycle / cycleDuration;

      let y;
      const jumpWindow = p.jumpDuration / cycleDuration; // fraction of cycle spent jumping
      if (jumpRatio < jumpWindow) {
        const t = jumpRatio / jumpWindow; // 0..1 within jump
        const arc = 4 * t * (1 - t);
        y = p.waterY + arc * p.jumpHeight;
      } else {
        y = p.waterY - 2;
      }

      d.mesh.position.set(p.x, y, p.z);

      // Face heading direction
      d.mesh.rotation.y = p.heading;

      // Pitch: nose up when jumping out, nose down when diving back
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
