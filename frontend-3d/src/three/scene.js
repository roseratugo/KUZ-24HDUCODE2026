/**
 * GameScene — Moteur de rendu 3D principal
 *
 * Cette classe gere toute la scene Three.js :
 * - Renderer WebGL avec antialiasing et tone mapping cinema (ACES Filmic)
 * - Ocean anime (shader Water de Three.js avec vagues et reflets)
 * - Ciel procedural (shader Sky avec soleil configurable)
 * - Bateau 3D avec interpolation fluide entre les positions
 * - Iles procedurales generees a partir des cellules SAND de la carte
 * - Faune : oiseaux en orbite autour des iles + dauphins autour du bateau
 * - Systeme de saut/salto du bateau (touche Y)
 *
 * Systeme de coordonnees :
 *   Grille du jeu (x, y) → Three.js (x * CELL_SIZE, hauteur, -y * CELL_SIZE)
 *   L'axe Y du jeu est inverse en Z dans Three.js
 */

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
    this.cells = new Map();                 // Toutes les cellules connues, cle "x,y"
    this.shipPosition = { x: 0, y: 0 };    // Position actuelle sur la grille du jeu
    this.clock = new THREE.Clock();
    this.boat = null;                        // Modele 3D du bateau

    this.CELL_SIZE = 10;                     // 1 cellule de jeu = 10 unites Three.js

    this.init();
    this.loadShipModel();
    this.animate();
  }

  /**
   * Initialisation de la scene Three.js
   * Cree le renderer, la camera, l'eau, le ciel, les lumieres,
   * et les managers pour les iles, oiseaux et dauphins
   */
  init() {
    // --- Renderer ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Limite le pixel ratio a 2 pour eviter de tuer les GPU sur les ecrans Retina
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Tone mapping ACES Filmic = rendu cinematographique (meilleurs contrastes/couleurs)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.container.appendChild(this.renderer.domElement);

    // --- Scene + brouillard ---
    this.scene = new THREE.Scene();
    // Le brouillard masque les iles lointaines et cree une impression de profondeur
    // start=200 : le brouillard commence a 200 unites, end=800 : opaque a 800
    this.scene.fog = new THREE.Fog(0x8eafc1, 200, 800);

    // --- Camera ---
    // Perspective 55° de FOV, vue de 1 a 1500 unites
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 1500);
    this.camera.position.set(30, 40, 100); // Position initiale : legrement au-dessus et derriere

    // --- OrbitControls : drag + zoom autour du bateau ---
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.45;  // Empeche la camera de passer sous l'eau
    this.controls.minDistance = 10;                   // Zoom min
    this.controls.maxDistance = 300;                  // Zoom max
    this.controls.enableDamping = true;              // Inertie douce sur le drag
    this.controls.dampingFactor = 0.05;

    this.sun = new THREE.Vector3();

    // --- Ocean anime ---
    // Plan de 2000x2000 unites avec le shader Water de Three.js
    // Les normales (waternormals.jpg) creent l'illusion de vagues
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
      waterColor: 0x001e0f,      // Vert fonce profond
      distortionScale: 3.7,       // Intensite de la deformation des vagues
      fog: true
    });
    this.water.rotation.x = -Math.PI / 2; // Horizontal (le plan est vertical par defaut)
    this.water.position.y = 0;
    this.scene.add(this.water);

    // --- Ciel procedural ---
    this.sky = new Sky();
    this.sky.scale.setScalar(10000); // Enorme sphere pour couvrir tout le fond
    this.scene.add(this.sky);

    // Parametres atmospheriques du ciel
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;         // Brume atmospherique
    skyUniforms['rayleigh'].value = 2;            // Diffusion (bleu du ciel)
    skyUniforms['mieCoefficient'].value = 0.005;  // Diffusion Mie (halo solaire)
    skyUniforms['mieDirectionalG'].value = 0.8;

    this.updateSun();

    // --- Lumieres ---
    // Ambiante bleutee (simule la lumiere reflechie par le ciel/ocean)
    const ambientLight = new THREE.AmbientLight(0x6688aa, 1.5);
    this.scene.add(ambientLight);
    // Directionnelle blanc chaud (simule le soleil)
    const directionalLight = new THREE.DirectionalLight(0xfff4e0, 2.5);
    directionalLight.position.set(50, 100, 50);
    this.scene.add(directionalLight);

    // --- Etat d'interpolation du bateau ---
    // Le bateau ne se teleporte pas : il glisse en douceur entre les positions
    this.targetBoatPos = new THREE.Vector3(0, 11, 0);   // Position cible
    this.prevTargetPos = new THREE.Vector3(0, 11, 0);    // Position precedente
    this.smoothedTarget = new THREE.Vector3(0, 11, 0);   // Position interpolee courante
    this.boatVelocity = new THREE.Vector3(0, 0, 0);      // Vitesse estimee (pour prediction)
    this.boatHeading = 0;         // Direction actuelle du bateau (radians)
    this.targetHeading = 0;       // Direction cible
    this.lastUpdateTime = 0;      // Timestamp du dernier updateShipPosition
    this.updateInterval = 0.2;    // Duree estimee entre updates (EMA, moyenne mobile)
    this.interpProgress = 1;      // 0→1 : progression de l'interpolation courante

    // Vecteurs temporaires reutilises chaque frame (evite les allocations dans animate())
    this._toTarget = new THREE.Vector3();
    this._scenePos = new THREE.Vector3();
    this._predicted = new THREE.Vector3();

    // --- Managers de la faune et des iles ---
    this.islandManager = new IslandManager(this.scene, this.CELL_SIZE);
    this.birdManager = new BirdManager(this.scene);
    this._birdsSpawned = false;
    this.dolphinManager = new DolphinManager(this.scene);
    this._dolphinsSpawned = false;

    // --- Systeme de saut (touche Y) ---
    this._jumpTimer = -1;           // -1 = pas en cours, >=0 = temps ecoule du saut
    this._jumpTotalDuration = 3.0;  // Duree totale du saut+plongee en secondes
    this._jumpHeight = 18;          // Hauteur max du saut
    this._diveDepth = 5;            // Profondeur de la plongee apres le saut
    this._onKeyDown = (e) => {
      if (e.key === 'y' || e.key === 'Y') this.triggerJump();
    };
    window.addEventListener('keydown', this._onKeyDown);

    this._onResize = () => this.onResize();
    window.addEventListener('resize', this._onResize);
  }

  /** Charge le modele GLTF du bateau, avec fallback sur un cube brun */
  async loadShipModel() {
    try {
      this.boat = await loadBoat();
      this.boat.position.set(0, 9, 0);
      this.scene.add(this.boat);

    } catch (err) {
      console.error('Ship model load failed, using fallback');
      const geo = new THREE.BoxGeometry(4, 2, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
      this.boat = new THREE.Mesh(geo, mat);
      this.boat.position.set(0, 9, 0);
      this.scene.add(this.boat);
    }
  }

  /** Configure la position du soleil (affecte le ciel et les reflets sur l'eau) */
  updateSun() {
    const phi = THREE.MathUtils.degToRad(60);    // Elevation : 60° au-dessus de l'horizon
    const theta = THREE.MathUtils.degToRad(180); // Azimut : plein sud
    this.sun.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms['sunPosition'].value.copy(this.sun);
    this.water.material.uniforms['sunDirection'].value.copy(this.sun).normalize();
  }

  /**
   * Convertit des coordonnees de la grille du jeu en position Three.js
   * L'axe Y du jeu est inverse en Z (convention Three.js : Z pointe vers l'ecran)
   */
  worldToScene(x, y, target) {
    const out = target || this._scenePos;
    return out.set(x * this.CELL_SIZE, 0, -y * this.CELL_SIZE);
  }

  /**
   * Met a jour la position cible du bateau
   *
   * Ne deplace pas le bateau instantanement — met a jour les variables d'interpolation
   * que la boucle animate() utilisera pour un mouvement fluide.
   *
   * Calcule aussi la velocite et la direction pour la prediction de mouvement.
   * L'updateInterval est calcule avec une moyenne mobile exponentielle (EMA)
   * pour s'adapter aux variations de frequence des mises a jour.
   */
  updateShipPosition(pos) {
    if (!pos) return;
    const moved = pos.x !== this.shipPosition.x || pos.y !== this.shipPosition.y;
    this.shipPosition = pos;
    const scenePos = this.worldToScene(pos.x, pos.y);

    const now = performance.now() / 1000;

    // Sauvegarde la position precedente pour l'interpolation
    this.prevTargetPos.copy(this.targetBoatPos);

    // Moyenne mobile exponentielle de l'intervalle entre updates
    // Poids 0.3 : 30% nouvelle mesure, 70% ancienne → lissage
    if (this.lastUpdateTime > 0) {
      const dt = now - this.lastUpdateTime;
      if (dt > 0.01 && dt < 2) {
        this.updateInterval = this.updateInterval * 0.7 + dt * 0.3;
      }
    }
    this.lastUpdateTime = now;

    // Calcule la vitesse et la direction si le bateau a bouge
    if (moved) {
      const dx = scenePos.x - this.prevTargetPos.x;
      const dz = scenePos.z - this.prevTargetPos.z;
      this.boatVelocity.set(dx / this.updateInterval, 0, dz / this.updateInterval);
      this.targetHeading = Math.atan2(dx, dz);
    } else {
      this.boatVelocity.set(0, 0, 0);
    }

    this.targetBoatPos.set(scenePos.x, 11, scenePos.z);
    this.interpProgress = 0; // Reset l'interpolation → le bateau va glisser vers la cible

    if (moved) {
      this.refreshNearbyIslands(); // Regenere les iles proches si on a bouge
    }

    this._trySpawnDolphins(scenePos.x, scenePos.z);
  }

  /** Tente de spawner les dauphins (attend que le modele GLTF soit charge) */
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

  /**
   * Regenere les iles dans un rayon de 100 cellules autour du bateau
   * Seules les cellules SAND dans ce rayon sont envoyees a l'IslandManager
   * Les iles plus lointaines sont cachees (optimisation)
   */
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
      // Distance au carre pour eviter le sqrt (optimisation classique)
      if (dx * dx + dy * dy <= RENDER_RADIUS * RENDER_RADIUS) {
        this.islandManager.addCell(cell);
      }
    }

    this._trySpawnBirds(prevHash);
  }

  /** Spawne les oiseaux si les iles ont change (hash different) */
  _trySpawnBirds(prevHash) {
    if (!this.birdManager.ready) {
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
    if (this.islandManager.lastHash !== prevHash) {
      this._spawnBirdsForIslands();
    }
  }

  /**
   * Cree des vols d'oiseaux pour chaque cluster d'ile assez grand
   * Seules les "vraies" iles (avec une reference island dans les cellules) ont des oiseaux
   * Les iles du mode dev (sans reference) n'en ont pas
   */
  _spawnBirdsForIslands() {
    this.birdManager.clear();
    const clusters = this.islandManager.findClusters();
    for (let i = 0; i < clusters.length; i++) {
      const cells = clusters[i];
      if (cells.length < 3) continue;

      // Verifie qu'au moins une cellule a une reference "island" du backend
      let isRealIsland = false;
      for (const c of cells) {
        const stored = this.cells.get(`${c.x},${c.y}`);
        if (stored && stored.island) {
          isRealIsland = true;
          break;
        }
      }
      if (!isRealIsland) continue;

      // Calcule le centre du cluster (centroide)
      let sumX = 0, sumY = 0;
      for (const c of cells) { sumX += c.x; sumY += c.y; }
      const cx = (sumX / cells.length) * this.CELL_SIZE;
      const cz = -(sumY / cells.length) * this.CELL_SIZE;
      const radius = Math.sqrt(cells.length) * this.CELL_SIZE * 0.5;

      // Seed deterministe basee sur l'index + taille → meme ile = memes oiseaux
      this.birdManager.spawnFlock(
        new THREE.Vector3(cx, 0, cz),
        Math.max(radius, 15),
        i * 137 + cells.length
      );
    }
  }

  /** Ajoute des cellules a la carte et met a jour les iles proches */
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
    if (this._jumpTimer >= 0) return; // Un saut est deja en cours
    this._jumpTimer = 0;
  }

  updateIsland(island) {
    this.islandManager.updateIsland(island);
  }

  /**
   * Boucle d'animation principale — appelee a chaque frame (~60fps)
   *
   * Gere dans l'ordre :
   * 1. Animation de l'eau (avance le temps du shader)
   * 2. Interpolation de la position du bateau (smoothstep + prediction)
   * 3. Rotation du bateau vers sa direction de deplacement
   * 4. Animation de saut/salto si actif (touche Y)
   * 5. Oscillation verticale (bob) simulant les vagues
   * 6. L'eau suit le bateau (le plan d'eau se deplace avec lui pour l'infini)
   * 7. La camera suit le bateau en douceur
   * 8. Mise a jour des oiseaux et dauphins
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    this.elapsedTime = (this.elapsedTime || 0) + delta;
    const time = this.elapsedTime;

    // 1. Anime les vagues de l'ocean
    this.water.material.uniforms['time'].value = time;

    if (this.boat) {
      // 2. Interpolation de position avec smoothstep
      // interpProgress va de 0 a 1 sur la duree estimee entre deux mises a jour
      this.interpProgress = Math.min(1, this.interpProgress + delta / this.updateInterval);

      const t = this.interpProgress;
      // Smoothstep : acceleration douce puis deceleration douce (pas de mouvement brusque)
      const ease = t * t * (3 - 2 * t);

      // Interpolation lineaire entre position precedente et cible, modulee par ease
      this.smoothedTarget.lerpVectors(this.prevTargetPos, this.targetBoatPos, ease);

      // Prediction de velocite : au-dela de 50% du trajet, on anticipe la prochaine position
      // Ca evite que le bateau "freine" quand on recoit une nouvelle position
      const prediction = Math.max(0, (t - 0.5) * 0.3);
      this._predicted.copy(this.boatVelocity).multiplyScalar(prediction * this.updateInterval);
      this.smoothedTarget.add(this._predicted);
      this.smoothedTarget.y = 11; // Hauteur fixe (au-dessus de l'eau)

      // Lerp final : le bateau s'approche exponentiellement de la cible
      // pow(0.005, delta) ≈ 0 quand delta est grand → lerp rapide
      const toTarget = this._toTarget.set(
        this.smoothedTarget.x - this.boat.position.x,
        0,
        this.smoothedTarget.z - this.boat.position.z
      );
      const distToTarget = toTarget.length();

      const lerpSpeed = 1 - Math.pow(0.005, delta);
      this.boat.position.x += (this.smoothedTarget.x - this.boat.position.x) * lerpSpeed;
      this.boat.position.z += (this.smoothedTarget.z - this.boat.position.z) * lerpSpeed;

      // 3. Rotation douce vers la direction de deplacement
      // Gere le wrap-around des angles (ex: de 350° a 10° = +20°, pas -340°)
      let headingDiff = this.targetHeading - this.boatHeading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      this.boatHeading += headingDiff * Math.min(1, 3.0 * delta);

      this.boat.rotation.order = 'YXZ'; // Applique Y (heading) puis X (pitch) puis Z (roll)
      this.boat.rotation.y = this.boatHeading;

      // 4. Saut/salto (touche Y)
      let jumpY = 0;
      let flipAngle = 0;
      let isFlipping = false;
      if (this._jumpTimer >= 0) {
        this._jumpTimer += delta;
        const totalT = this._jumpTimer / this._jumpTotalDuration;
        if (totalT >= 1) {
          this._jumpTimer = -1; // Saut termine
        } else {
          isFlipping = true;
          const t = totalT;
          // Phase 1 (0–75%) : arc parabolique vers le haut
          if (t < 0.75) {
            const p = t / 0.75;
            jumpY = this._jumpHeight * 4 * p * (1 - p); // Parabole : max au milieu
          } else {
            // Phase 2 (75–100%) : plongee sous l'eau
            const p = (t - 0.75) / 0.25;
            jumpY = -this._diveDepth * Math.sin(p * Math.PI);
          }

          // Animation de rotation (salto avant complet = 360°)
          if (t < 0.1) {
            const p = t / 0.1;
            flipAngle = p * p * 0.2; // Debut lent
          } else if (t < 0.7) {
            const p = (t - 0.1) / 0.6;
            const ease = p * p * (3 - 2 * p);
            flipAngle = 0.2 + ease * (Math.PI * 2 - 0.2); // Rotation principale
          } else if (t < 0.85) {
            const p = (t - 0.7) / 0.15;
            flipAngle = Math.PI * 2 * (1 + 0.03 * (1 - p)); // Legere surrotation
          } else {
            const p = (t - 0.85) / 0.15;
            flipAngle = Math.PI * 2 * (1 - p * p * (3 - 2 * p)) * 0.03; // Retour au repos
          }
        }
      }

      // 5. Pitch (inclinaison avant/arriere) + bob (oscillation verticale)
      const speed = Math.min(1, distToTarget);
      if (isFlipping) {
        this.boat.rotation.x = flipAngle;
        this.boat.rotation.z = 0;
      } else {
        // Le bateau s'incline legerement vers l'avant quand il avance
        const targetPitch = -speed * 0.03 + Math.sin(time * 1.2) * 0.015;
        this.boat.rotation.x = THREE.MathUtils.lerp(this.boat.rotation.x, targetPitch, 1 - Math.pow(0.05, delta));
        this.boat.rotation.z = THREE.MathUtils.lerp(this.boat.rotation.z, 0, 1 - Math.pow(0.005, delta));
      }

      // Oscillation verticale : 2 sinus superposes pour un mouvement naturel
      this.boat.position.y = 11 + Math.sin(time * 1.5) * 0.3 + Math.sin(time * 2.3) * 0.1 + jumpY;

      // 6. L'eau "suit" le bateau → illusion d'un ocean infini
      this.water.position.x = this.boat.position.x;
      this.water.position.z = this.boat.position.z;

      // 7. La camera suit le bateau en douceur
      const camSpeed = 1 - Math.pow(0.05, delta);
      this.controls.target.lerp(this.boat.position, camSpeed);
    }

    // 8. Anime les oiseaux (orbite) et les dauphins (sauts)
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

  /** Nettoie toutes les ressources Three.js et les event listeners */
  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKeyDown);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
