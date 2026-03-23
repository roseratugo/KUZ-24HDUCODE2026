import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const BIRD_SCALE = 5;
const FLIGHT_HEIGHT_MIN = 20;
const FLIGHT_HEIGHT_MAX = 35;
const ORBIT_SPEED_MIN = 0.3;
const ORBIT_SPEED_MAX = 0.7;
const BIRDS_PER_ISLAND = 3;

export class BirdManager {
  constructor(scene) {
    this.scene = scene;
    this.birdTemplate = null;
    this.templateAnimations = null;
    this.flocks = [];
    this.ready = false;

    this._loadTemplate();
  }

  _loadTemplate() {
    const loader = new GLTFLoader();
    loader.load(
      '/models/bird/scene.gltf',
      (gltf) => {
        this.birdTemplate = gltf.scene;
        this.templateAnimations = gltf.animations;

        const box = new THREE.Box3().setFromObject(this.birdTemplate);
        const size = box.getSize(new THREE.Vector3());
        this._templateMaxDim = Math.max(size.x, size.y, size.z);

        this.ready = true;
        console.log('[Birds] Template loaded, animations:', this.templateAnimations.length);
      },
      undefined,
      (err) => console.warn('[Birds] Failed to load bird model:', err)
    );
  }

  spawnFlock(center, radius, seed) {
    if (!this.ready) return;

    const count = Math.min(BIRDS_PER_ISLAND, 2 + (seed % 3));
    const birds = [];

    for (let i = 0; i < count; i++) {
      const birdScene = SkeletonUtils.clone(this.birdTemplate);

      const s = BIRD_SCALE / this._templateMaxDim;
      birdScene.scale.setScalar(s);

      const group = new THREE.Group();
      group.add(birdScene);
      this.scene.add(group);

      let mixer = null;
      let action = null;
      if (this.templateAnimations.length > 0) {
        mixer = new THREE.AnimationMixer(birdScene);
        action = mixer.clipAction(this.templateAnimations[0]);
        action.timeScale = 5 + Math.random() * 3;
        action.time = Math.random() * (this.templateAnimations[0].duration || 1);
        action.play();
      }

      const params = {
        orbitRadius: radius * (0.5 + Math.random() * 0.6),
        orbitSpeed: ORBIT_SPEED_MIN + Math.random() * (ORBIT_SPEED_MAX - ORBIT_SPEED_MIN),
        height: FLIGHT_HEIGHT_MIN + Math.random() * (FLIGHT_HEIGHT_MAX - FLIGHT_HEIGHT_MIN),
        phaseOffset: (i / count) * Math.PI * 2 + (seed * 0.7),
        bobFreq: 0.8 + Math.random() * 0.6,
        bobAmp: 0.5 + Math.random() * 0.5,
        center: center.clone(),
        bankAmount: 0.15 + Math.random() * 0.15,
      };

      birds.push({ mesh: group, mixer, action, params });
    }

    this.flocks.push({ birds });
  }

  clear() {
    for (const flock of this.flocks) {
      for (const bird of flock.birds) {
        this.scene.remove(bird.mesh);
        if (bird.mixer) bird.mixer.stopAllAction();
      }
    }
    this.flocks = [];
  }

  update(delta, elapsed) {
    for (const flock of this.flocks) {
      for (const bird of flock.birds) {
        if (bird.mixer) bird.mixer.update(delta);

        const p = bird.params;
        const angle = elapsed * p.orbitSpeed + p.phaseOffset;

        const x = p.center.x + Math.cos(angle) * p.orbitRadius;
        const z = p.center.z + Math.sin(angle) * p.orbitRadius;
        const y = p.height + Math.sin(elapsed * p.bobFreq + p.phaseOffset) * p.bobAmp;

        bird.mesh.position.set(x, y, z);

        const tx = -Math.sin(angle);
        const tz = Math.cos(angle);
        bird.mesh.rotation.y = Math.atan2(tx, tz);

        bird.mesh.rotation.z = -p.bankAmount;
      }
    }
  }
}
