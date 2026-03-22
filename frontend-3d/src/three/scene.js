import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { loadBoat } from './boat.js';
import { IslandManager } from './islands.js';

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

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
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

    // Water
    const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
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
      fog: this.scene.fog !== undefined
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

    // Ship physics
    this.targetBoatPos = new THREE.Vector3(0, 9, 0);
    this.boatVelocity = new THREE.Vector3(0, 0, 0);
    this.boatHeading = 0; // current facing angle
    this.targetHeading = 0; // desired angle
    this.boatSpeed = 0; // current scalar speed
    this.prevTargetPos = new THREE.Vector3(0, 9, 0);

    // Islands
    this.islandManager = new IslandManager(this.scene, this.CELL_SIZE);

    // Resize
    this._onResize = () => this.onResize();
    window.addEventListener('resize', this._onResize);
  }

  async loadShipModel() {
    try {
      this.boat = await loadBoat();
      this.boat.position.set(0, 9, 0);
      this.scene.add(this.boat);
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

  worldToScene(x, y) {
    return new THREE.Vector3(x * this.CELL_SIZE, 0, -y * this.CELL_SIZE);
  }

  updateShipPosition(pos) {
    if (!pos) return;
    const moved = pos.x !== this.shipPosition.x || pos.y !== this.shipPosition.y;
    this.shipPosition = pos;
    const scenePos = this.worldToScene(pos.x, pos.y);
    this.targetBoatPos.set(scenePos.x, 9, scenePos.z);

    // Refresh nearby islands when ship moves
    if (moved) {
      this.refreshNearbyIslands();
    }
  }

  refreshNearbyIslands() {
    const RENDER_RADIUS = 100;
    const sx = this.shipPosition.x;
    const sy = this.shipPosition.y;

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
      const ACCELERATION = 8;    // units/s²
      const DECELERATION = 4;    // drag when no target diff
      const MAX_SPEED = 25;      // max units/s
      const TURN_SPEED = 2.0;    // radians/s
      const ARRIVE_DIST = 0.5;   // stop threshold

      // Direction to target
      const toTarget = new THREE.Vector3(
        this.targetBoatPos.x - this.boat.position.x,
        0,
        this.targetBoatPos.z - this.boat.position.z
      );
      const distToTarget = toTarget.length();

      if (distToTarget > ARRIVE_DIST) {
        // Calculate desired heading
        this.targetHeading = Math.atan2(toTarget.x, toTarget.z) + Math.PI / 2;

        // Accelerate
        this.boatSpeed = Math.min(MAX_SPEED, this.boatSpeed + ACCELERATION * delta);

        // Slow down when approaching target (braking)
        const brakeDist = (this.boatSpeed * this.boatSpeed) / (2 * DECELERATION);
        if (distToTarget < brakeDist) {
          this.boatSpeed = Math.max(2, this.boatSpeed - DECELERATION * 2 * delta);
        }
      } else {
        // Decelerate to stop
        this.boatSpeed = Math.max(0, this.boatSpeed - DECELERATION * delta);
      }

      // Smooth heading turn (shortest path)
      let headingDiff = this.targetHeading - this.boatHeading;
      // Normalize to [-PI, PI]
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      this.boatHeading += headingDiff * Math.min(1, TURN_SPEED * delta);

      // Move forward along heading
      if (this.boatSpeed > 0.01) {
        const moveAngle = this.boatHeading - Math.PI / 2; // undo the +90 offset
        this.boat.position.x += Math.sin(moveAngle) * this.boatSpeed * delta;
        this.boat.position.z += Math.cos(moveAngle) * this.boatSpeed * delta;
      }

      // Apply heading rotation
      this.boat.rotation.y = this.boatHeading;

      // Roll in turns (lean into the turn)
      const turnRate = headingDiff * TURN_SPEED;
      const targetRoll = THREE.MathUtils.clamp(turnRate * 0.15, -0.12, 0.12);
      this.boat.rotation.z = THREE.MathUtils.lerp(this.boat.rotation.z, targetRoll, 1 - Math.pow(0.01, delta));

      // Pitch from speed (nose up when accelerating, down when braking)
      const speedRatio = this.boatSpeed / MAX_SPEED;
      const targetPitch = -speedRatio * 0.04 + Math.sin(time * 1.2) * 0.02;
      this.boat.rotation.x = THREE.MathUtils.lerp(this.boat.rotation.x, targetPitch, 1 - Math.pow(0.05, delta));

      // Bobbing (wave motion)
      this.boat.position.y = 9 + Math.sin(time * 1.5) * 0.3 + Math.sin(time * 2.3) * 0.1;

      // Wake effect: slightly lift stern at speed
      this.boat.position.y += speedRatio * 0.4;

      // Camera: smoothly follow boat
      const camSpeed = 1 - Math.pow(0.1, delta);
      this.controls.target.lerp(this.boat.position, camSpeed);
    }

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
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
