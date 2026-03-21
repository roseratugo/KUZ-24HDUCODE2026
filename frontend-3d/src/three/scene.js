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
    this.renderer.toneMappingExposure = 0.5;
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
    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(50, 100, 50);
    this.scene.add(directionalLight);

    // Target position for smooth movement
    this.targetBoatPos = new THREE.Vector3(0, 9, 0);

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
    const phi = THREE.MathUtils.degToRad(88);
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
    this.shipPosition = pos;
    const scenePos = this.worldToScene(pos.x, pos.y);
    this.targetBoatPos.set(scenePos.x, 9, scenePos.z);
  }

  updateCells(cells) {
    cells.forEach(cell => {
      const key = `${cell.x},${cell.y}`;
      if (!this.cells.has(key)) {
        this.cells.set(key, cell);
        if (cell.type === 'SAND' || cell.island) {
          this.islandManager.addCell(cell);
        }
      }
    });
  }

  updateIsland(island) {
    this.islandManager.updateIsland(island);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const time = this.clock.getElapsedTime();

    // Water animation
    this.water.material.uniforms['time'].value = time;

    if (this.boat) {
      // Smooth boat movement
      this.boat.position.lerp(this.targetBoatPos, 0.05);

      // Boat bobbing
      this.boat.position.y = 9 + Math.sin(time * 1.5) * 0.3;
      this.boat.rotation.z = Math.sin(time * 0.8) * 0.03;
      this.boat.rotation.x = Math.sin(time * 1.2) * 0.02;

      // Rotate boat towards movement direction
      const dir = this.targetBoatPos.clone().sub(this.boat.position);
      if (dir.lengthSq() > 1) {
        const angle = Math.atan2(dir.x, dir.z);
        this.boat.rotation.y = THREE.MathUtils.lerp(
          this.boat.rotation.y,
          angle,
          0.05
        );
      }

      // Camera follows boat
      const camOffset = new THREE.Vector3(25, 30, 50);
      const targetCamPos = this.boat.position.clone().add(camOffset);
      this.camera.position.lerp(targetCamPos, 0.03);
      this.controls.target.lerp(this.boat.position, 0.05);
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
