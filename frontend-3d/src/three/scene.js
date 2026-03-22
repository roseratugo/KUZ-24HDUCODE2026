import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { loadBoat } from './boat.js';
import { IslandManager } from './islands.js';
import { BirdManager } from './birds.js';
import { DolphinManager } from './dolphins.js';

export class GameScene {
  constructor(container) {
    this.container = container;
    this.cells = new Map();
    this.shipPosition = { x: 0, y: 0 };
    this.clock = new THREE.Clock();
    this.boat = null;

    this.CELL_SIZE = 10;

    this.init();
    this.loadShipModel();
    this.animate();
  }

  init() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8eafc1, 200, 800);

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 1500);
    this.camera.position.set(30, 40, 100);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 300;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Sun
    this.sun = new THREE.Vector3();

    // Water (sized to fog far distance, not overkill)
    const waterGeometry = new THREE.PlaneGeometry(2000, 2000);
    this.water = new Water(waterGeometry, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: new THREE.TextureLoader().load(
        'https://threejs.org/examples/textures/waternormals.jpg',
        (texture) => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        }
      ),
      sunDirection: new THREE.Vector3(),
      sunColor: 0xffffff,
      waterColor: 0x001e0f,
      distortionScale: 3.7,
      fog: true
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0;
    this.scene.add(this.water);

    // Sky
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.scene.add(this.sky);

    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;

    this.updateSun();

    // Lights
    const ambientLight = new THREE.AmbientLight(0x6688aa, 1.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xfff4e0, 2.5);
    directionalLight.position.set(50, 100, 50);
    this.scene.add(directionalLight);

    // Ship physics — smooth interpolation between server updates
    this.targetBoatPos = new THREE.Vector3(0, 11, 0);   // current server target
    this.prevTargetPos = new THREE.Vector3(0, 11, 0);    // previous server target
    this.smoothedTarget = new THREE.Vector3(0, 11, 0);   // interpolated target (what we actually chase)
    this.boatVelocity = new THREE.Vector3(0, 0, 0);     // estimated velocity from server updates
    this.boatHeading = 0;
    this.targetHeading = 0;
    this.lastUpdateTime = 0;       // timestamp of last server update
    this.updateInterval = 0.2;     // estimated interval between server updates (seconds)
    this.interpProgress = 1;       // 0..1 progress between prev and current target

    // Pre-allocated vectors for animate() to avoid per-frame GC
    this._toTarget = new THREE.Vector3();
    this._scenePos = new THREE.Vector3();
    this._predicted = new THREE.Vector3();

    // Islands
    this.islandManager = new IslandManager(this.scene, this.CELL_SIZE);

    // Birds
    this.birdManager = new BirdManager(this.scene);
    this._birdsSpawned = false;

    // Dolphins
    this.dolphinManager = new DolphinManager(this.scene);
    this._dolphinsSpawned = false;

    // Boat backflip (Y key)
    this._jumpTimer = -1;       // -1 = not jumping
    this._jumpTotalDuration = 3.0; // total animation time
    this._jumpHeight = 18;
    this._diveDepth = 5;
    this._onKeyDown = (e) => {
      if (e.key === 'y' || e.key === 'Y') this.triggerJump();
    };
    window.addEventListener('keydown', this._onKeyDown);

    // Resize
    this._onResize = () => this.onResize();
    window.addEventListener('resize', this._onResize);
  }

  async loadShipModel() {
    try {
      this.boat = await loadBoat();
      this.boat.position.set(0, 9, 0);
      this.scene.add(this.boat);

      // Debug axes: R=X, G=Y, B=Z (arrow points forward)
      const axes = new THREE.AxesHelper(20);
      this.boat.add(axes);
    } catch (err) {
      console.error('Ship model load failed, using fallback');
      // Fallback: simple box
      const geo = new THREE.BoxGeometry(4, 2, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
      this.boat = new THREE.Mesh(geo, mat);
      this.boat.position.set(0, 9, 0);
      this.scene.add(this.boat);
    }
  }

  updateSun() {
    const phi = THREE.MathUtils.degToRad(60);
    const theta = THREE.MathUtils.degToRad(180);

    this.sun.setFromSphericalCoords(1, phi, theta);

    this.sky.material.uniforms['sunPosition'].value.copy(this.sun);
    this.water.material.uniforms['sunDirection'].value.copy(this.sun).normalize();
  }

  worldToScene(x, y, target) {
    const out = target || this._scenePos;
    return out.set(x * this.CELL_SIZE, 0, -y * this.CELL_SIZE);
  }

  updateShipPosition(pos) {
    if (!pos) return;
    const moved = pos.x !== this.shipPosition.x || pos.y !== this.shipPosition.y;
    this.shipPosition = pos;
    const scenePos = this.worldToScene(pos.x, pos.y);

    const now = performance.now() / 1000;

    // Save previous target before overwriting
    this.prevTargetPos.copy(this.targetBoatPos);

    // Estimate update interval from actual timing
    if (this.lastUpdateTime > 0) {
      const dt = now - this.lastUpdateTime;
      if (dt > 0.01 && dt < 2) {
        // Smooth the interval estimate
        this.updateInterval = this.updateInterval * 0.7 + dt * 0.3;
      }
    }
    this.lastUpdateTime = now;

    // Compute velocity from position delta
    if (moved) {
      this.boatVelocity.set(
        (scenePos.x - this.prevTargetPos.x) / this.updateInterval,
        0,
        (scenePos.z - this.prevTargetPos.z) / this.updateInterval
      );
    } else {
      this.boatVelocity.set(0, 0, 0);
    }

    // Set the new target and reset interpolation progress
    this.targetBoatPos.set(scenePos.x, 11, scenePos.z);
    this.interpProgress = 0;

    if (moved) {
      this.refreshNearbyIslands();
    }

    // Spawn dolphins around the boat
    this._trySpawnDolphins(scenePos.x, scenePos.z);
  }

  _trySpawnDolphins(sx, sz) {
    if (!this.dolphinManager.ready) {
      if (!this._dolphinRetry) {
        this._dolphinRetry = setInterval(() => {
          if (this.dolphinManager.ready) {
            clearInterval(this._dolphinRetry);
            this._dolphinRetry = null;
            this.dolphinManager.spawn(this.targetBoatPos.x, this.targetBoatPos.z);
            this._dolphinsSpawned = true;
          }
        }, 500);
      }
      return;
    }
    if (!this._dolphinsSpawned) {
      this.dolphinManager.spawn(sx, sz);
      this._dolphinsSpawned = true;
    }
  }

  refreshNearbyIslands() {
    const RENDER_RADIUS = 100;
    const sx = this.shipPosition.x;
    const sy = this.shipPosition.y;

    const prevHash = this.islandManager.lastHash;
    this.islandManager.setShipPosition(sx, sy, RENDER_RADIUS);
    for (const [, cell] of this.cells) {
      if (cell.type !== 'SAND') continue;
      const dx = cell.x - sx;
      const dy = cell.y - sy;
      if (dx * dx + dy * dy <= RENDER_RADIUS * RENDER_RADIUS) {
        this.islandManager.addCell(cell);
      }
    }

    // Spawn birds above islands when layout changes
    this._trySpawnBirds(prevHash);
  }

  _trySpawnBirds(prevHash) {
    if (!this.birdManager.ready) {
      // Retry once the model is loaded
      if (!this._birdRetry) {
        this._birdRetry = setInterval(() => {
          if (this.birdManager.ready) {
            clearInterval(this._birdRetry);
            this._birdRetry = null;
            this._spawnBirdsForIslands();
          }
        }, 500);
      }
      return;
    }
    // Only respawn if island layout actually changed
    if (this.islandManager.lastHash !== prevHash) {
      this._spawnBirdsForIslands();
    }
  }

  _spawnBirdsForIslands() {
    this.birdManager.clear();
    const clusters = this.islandManager.findClusters();
    for (let i = 0; i < clusters.length; i++) {
      const cells = clusters[i];
      if (cells.length < 3) continue;

      // Only spawn birds on real islands (cells with island data)
      // Check if any cell in the cluster belongs to a known island
      let isRealIsland = false;
      for (const c of cells) {
        const stored = this.cells.get(`${c.x},${c.y}`);
        if (stored && stored.island) {
          isRealIsland = true;
          break;
        }
      }
      if (!isRealIsland) continue;

      // Compute island center in scene coords
      let sumX = 0, sumY = 0;
      for (const c of cells) { sumX += c.x; sumY += c.y; }
      const cx = (sumX / cells.length) * this.CELL_SIZE;
      const cz = -(sumY / cells.length) * this.CELL_SIZE;
      const radius = Math.sqrt(cells.length) * this.CELL_SIZE * 0.5;

      this.birdManager.spawnFlock(
        new THREE.Vector3(cx, 0, cz),
        Math.max(radius, 15),
        i * 137 + cells.length
      );
    }
  }

  updateCells(cells) {
    const RENDER_RADIUS = 100;
    const sx = this.shipPosition.x;
    const sy = this.shipPosition.y;

    cells.forEach(cell => {
      const key = `${cell.x},${cell.y}`;
      if (!this.cells.has(key)) {
        this.cells.set(key, cell);
      }
    });

    // Only send nearby SAND cells to island manager
    this.islandManager.setShipPosition(sx, sy, RENDER_RADIUS);
    for (const [, cell] of this.cells) {
      if (cell.type !== 'SAND') continue;
      const dx = cell.x - sx;
      const dy = cell.y - sy;
      if (dx * dx + dy * dy <= RENDER_RADIUS * RENDER_RADIUS) {
        this.islandManager.addCell(cell);
      }
    }
  }

  triggerJump() {
    if (this._jumpTimer >= 0) return; // already jumping
    this._jumpTimer = 0;
  }

  updateIsland(island) {
    this.islandManager.updateIsland(island);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    this.elapsedTime = (this.elapsedTime || 0) + delta;
    const time = this.elapsedTime;

    // Water animation
    this.water.material.uniforms['time'].value = time;

    if (this.boat) {
      // --- Smooth target interpolation between server updates ---
      // Advance interpolation progress based on expected update interval
      this.interpProgress = Math.min(1, this.interpProgress + delta / this.updateInterval);

      // Smoothstep easing for natural acceleration/deceleration
      const t = this.interpProgress;
      const ease = t * t * (3 - 2 * t);

      // Interpolate between previous and current target
      this.smoothedTarget.lerpVectors(this.prevTargetPos, this.targetBoatPos, ease);

      // Add velocity-based prediction to overshoot slightly for fluid motion
      const prediction = Math.max(0, (t - 0.5) * 0.3); // gentle extrapolation in 2nd half
      this._predicted.copy(this.boatVelocity).multiplyScalar(prediction * this.updateInterval);
      this.smoothedTarget.add(this._predicted);
      this.smoothedTarget.y = 11; // keep Y locked

      // --- Position: smooth chase toward the interpolated target ---
      const toTarget = this._toTarget.set(
        this.smoothedTarget.x - this.boat.position.x,
        0,
        this.smoothedTarget.z - this.boat.position.z
      );
      const distToTarget = toTarget.length();

      // Smooth movement toward target
      const lerpSpeed = 1 - Math.pow(0.005, delta);
      this.boat.position.x += (this.smoothedTarget.x - this.boat.position.x) * lerpSpeed;
      this.boat.position.z += (this.smoothedTarget.z - this.boat.position.z) * lerpSpeed;

      // Heading: face direction of movement
      if (distToTarget > 0.5) {
        this.targetHeading = Math.atan2(toTarget.x, toTarget.z);
      }

      // Smooth turn
      let headingDiff = this.targetHeading - this.boatHeading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      this.boatHeading += headingDiff * Math.min(1, 3.0 * delta);

      // Apply rotation (model bow aligned on +Z via boat.js rotation)
      this.boat.rotation.y = this.boatHeading;

      // Roll into turns
      const targetRoll = THREE.MathUtils.clamp(headingDiff * 0.4, -0.15, 0.15);
      this.boat.rotation.z = THREE.MathUtils.lerp(this.boat.rotation.z, targetRoll, 1 - Math.pow(0.005, delta));

      // Backflip animation (Y key)
      // Simulates gravity: launch velocity, gravity pulls down, splash + resurface
      let jumpY = 0;
      let flipAngle = 0;
      let isFlipping = false;
      if (this._jumpTimer >= 0) {
        this._jumpTimer += delta;
        const totalT = this._jumpTimer / this._jumpTotalDuration;
        if (totalT >= 1) {
          this._jumpTimer = -1;
        } else {
          isFlipping = true;
          // Gravity-based Y: parabola that goes negative (underwater)
          // y = v0*t - 0.5*g*t^2, calibrated so peak at t=0.4, splash at t=0.75, resurface at t=1
          const t = totalT;
          if (t < 0.75) {
            // Launch → peak → fall into water
            const p = t / 0.75;
            jumpY = this._jumpHeight * 4 * p * (1 - p); // parabola peaking at p=0.5 (t=0.375)
          } else {
            // Underwater dip → resurface
            const p = (t - 0.75) / 0.25;
            const dip = Math.sin(p * Math.PI); // 0 → 1 → 0
            jumpY = -this._diveDepth * dip;
          }

          // Backflip rotation on Z axis (because model is offset +PI/2 on Y)
          // Smooth full 360° rotation with easing
          if (t < 0.1) {
            // Wind up
            const p = t / 0.1;
            flipAngle = p * p * 0.2;
          } else if (t < 0.7) {
            // Main flip — full rotation
            const p = (t - 0.1) / 0.6;
            const ease = p * p * (3 - 2 * p);
            flipAngle = 0.2 + ease * (Math.PI * 2 - 0.2);
          } else if (t < 0.85) {
            // Settle back
            const p = (t - 0.7) / 0.15;
            flipAngle = Math.PI * 2 * (1 + 0.03 * (1 - p)); // slight overshoot
          } else {
            // Snap to clean 0
            const p = (t - 0.85) / 0.15;
            flipAngle = Math.PI * 2 * (1 - p * p * (3 - 2 * p)) * 0.03;
          }
        }
      }

      // Pitch + roll
      const speed = Math.min(1, distToTarget);
      if (isFlipping) {
        this.boat.rotation.z = targetRoll + flipAngle;
        this.boat.rotation.x = 0;
      } else {
        const targetPitch = -speed * 0.03 + Math.sin(time * 1.2) * 0.015;
        this.boat.rotation.x = THREE.MathUtils.lerp(this.boat.rotation.x, targetPitch, 1 - Math.pow(0.05, delta));
      }

      // Bobbing + jump
      this.boat.position.y = 11 + Math.sin(time * 1.5) * 0.3 + Math.sin(time * 2.3) * 0.1 + jumpY;

      // Water follows the boat so it's always visible
      this.water.position.x = this.boat.position.x;
      this.water.position.z = this.boat.position.z;

      // Camera follow — smoother
      const camSpeed = 1 - Math.pow(0.05, delta);
      this.controls.target.lerp(this.boat.position, camSpeed);
    }

    // Birds & Dolphins
    this.birdManager.update(delta, time);
    this.dolphinManager.update(delta, time);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKeyDown);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
