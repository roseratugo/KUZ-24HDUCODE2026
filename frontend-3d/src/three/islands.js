import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();
const noise2D_2 = createNoise2D();

export class IslandManager {
  constructor(scene, cellSize) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.islandMeshes = new Map();
    this.processedCells = new Set();
    this.islandCells = new Map();
  }

  addCell(cell) {
    const key = `${cell.x},${cell.y}`;
    if (this.processedCells.has(key)) return;
    this.processedCells.add(key);

    if (cell.island) {
      const islandId = cell.island.id || cell.island.name;
      if (!this.islandCells.has(islandId)) {
        this.islandCells.set(islandId, { name: cell.island.name, cells: [] });
      }
      this.islandCells.get(islandId).cells.push(cell);
      this.rebuildIsland(islandId);
    }
  }

  rebuildIsland(islandId) {
    if (this.islandMeshes.has(islandId)) {
      const old = this.islandMeshes.get(islandId);
      this.scene.remove(old);
      old.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    }

    const data = this.islandCells.get(islandId);
    if (!data || data.cells.length === 0) return;

    const group = new THREE.Group();

    const xs = data.cells.map(c => c.x);
    const ys = data.cells.map(c => c.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const spanX = Math.max(...xs) - Math.min(...xs) + 1;
    const spanY = Math.max(...ys) - Math.min(...ys) + 1;
    const radius = Math.max(spanX, spanY) / 2 + 1;

    const worldCX = centerX * this.cellSize;
    const worldCZ = -centerY * this.cellSize;
    const worldRadius = radius * this.cellSize;
    const seed = Math.abs(Math.round(worldCX * 137 + worldCZ * 311)) % 10000;

    // --- Main terrain ---
    const segments = 64;
    const size = worldRadius * 2.4;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const sandColor = new THREE.Color(0xf5deb3);
    const wetSandColor = new THREE.Color(0xc4a67a);
    const grassColor = new THREE.Color(0x4a8f2a);
    const darkGrassColor = new THREE.Color(0x2d5a1e);

    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i);
      const pz = positions.getZ(i);
      const dist = Math.sqrt(px * px + pz * pz) / worldRadius;

      // Organic coastline shape
      const angle = Math.atan2(pz, px);
      const coastNoise =
        noise2D(Math.cos(angle) * 1.8 + seed * 0.007, Math.sin(angle) * 1.8 + seed * 0.003) * 0.25 +
        noise2D(Math.cos(angle) * 3.5 + seed * 0.013, Math.sin(angle) * 3.5 + seed * 0.009) * 0.1;
      const shore = dist - coastNoise;

      // Smooth island profile
      const t = Math.max(0, 1 - shore);
      const profile = t * t * (3 - 2 * t); // smoothstep

      // Gentle terrain noise
      const wx = (px + worldCX) * 0.04;
      const wz = (pz + worldCZ) * 0.04;
      const terrainNoise =
        noise2D(wx, wz) * 1.0 +
        noise2D_2(wx * 2, wz * 2) * 0.4;

      const maxHeight = 4 + worldRadius * 0.15;
      let height = profile * maxHeight + terrainNoise * profile * 0.8;

      // Clamp: anything outside shore = underwater
      if (shore > 1.05) {
        height = -3;
      } else if (shore > 0.95) {
        // Smooth transition to water
        const fade = (shore - 0.95) / 0.1;
        height = height * (1 - fade) + (-3) * fade;
      }

      positions.setY(i, height);

      // Color by height
      const color = new THREE.Color();
      if (height < 0) {
        color.copy(wetSandColor);
      } else if (height < 0.8) {
        color.lerpColors(wetSandColor, sandColor, height / 0.8);
      } else if (height < 2.0) {
        color.lerpColors(sandColor, grassColor, (height - 0.8) / 1.2);
      } else {
        color.lerpColors(grassColor, darkGrassColor, Math.min(1, (height - 2.0) / 3));
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Remove underwater faces
    const index = geo.index;
    const newIndices = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const ya = positions.getY(a);
      const yb = positions.getY(b);
      const yc = positions.getY(c);
      // Keep triangle if at least one vertex is above water
      if (ya > -1 || yb > -1 || yc > -1) {
        newIndices.push(a, b, c);
      }
    }
    geo.setIndex(newIndices);

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide
    });

    const terrain = new THREE.Mesh(geo, material);
    terrain.receiveShadow = true;
    group.add(terrain);

    // --- Vegetation ---
    this.addPalmTrees(group, worldRadius, worldCX, worldCZ, seed, positions, geo);
    this.addRocks(group, worldRadius, seed);

    group.position.set(worldCX, 0, worldCZ);
    this.scene.add(group);
    this.islandMeshes.set(islandId, group);
  }

  sampleHeight(x, z, worldCX, worldCZ, worldRadius, seed) {
    const dist = Math.sqrt(x * x + z * z) / worldRadius;
    const angle = Math.atan2(z, x);
    const coastNoise =
      noise2D(Math.cos(angle) * 1.8 + seed * 0.007, Math.sin(angle) * 1.8 + seed * 0.003) * 0.25 +
      noise2D(Math.cos(angle) * 3.5 + seed * 0.013, Math.sin(angle) * 3.5 + seed * 0.009) * 0.1;
    const shore = dist - coastNoise;
    const t = Math.max(0, 1 - shore);
    const profile = t * t * (3 - 2 * t);
    const wx = (x + worldCX) * 0.04;
    const wz = (z + worldCZ) * 0.04;
    const terrainNoise = noise2D(wx, wz) * 1.0 + noise2D_2(wx * 2, wz * 2) * 0.4;
    const maxHeight = 4 + worldRadius * 0.15;
    return profile * maxHeight + terrainNoise * profile * 0.8;
  }

  addPalmTrees(group, radius, wx, wz, seed) {
    const count = Math.min(12, Math.floor(3 + radius * 0.3));
    for (let i = 0; i < count; i++) {
      const angle = ((i * 137.508 + seed) % 360) * Math.PI / 180;
      const dist = radius * (0.2 + Math.abs(noise2D(i * 0.5 + seed * 0.01, 0)) * 0.45);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const h = this.sampleHeight(x, z, wx, wz, radius, seed);
      if (h < 1.2 || h > 6) continue;

      const tree = this.createPalmTree(seed + i);
      tree.position.set(x, h - 0.2, z);
      tree.scale.setScalar(2.5 + Math.abs(noise2D(i, seed)) * 1.5);
      group.add(tree);
    }
  }

  createPalmTree(seed) {
    const tree = new THREE.Group();
    const trunkHeight = 3 + (seed % 3) * 0.5;
    const lean = 0.08 + (seed % 4) * 0.03;
    const leanDir = seed * 1.7;

    // Trunk
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(leanDir) * lean, trunkHeight * 0.4, Math.sin(leanDir) * lean),
      new THREE.Vector3(Math.cos(leanDir) * lean * 2, trunkHeight * 0.75, Math.sin(leanDir) * lean * 2),
      new THREE.Vector3(Math.cos(leanDir) * lean * 2.5, trunkHeight, Math.sin(leanDir) * lean * 2.5),
    ]);

    const trunkGeo = new THREE.TubeGeometry(curve, 8, 0.13, 5, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.95 });
    tree.add(new THREE.Mesh(trunkGeo, trunkMat));

    const top = curve.getPoint(1);

    // Fronds
    const frondCount = 6 + (seed % 3);
    for (let i = 0; i < frondCount; i++) {
      const fAngle = (i / frondCount) * Math.PI * 2 + seed * 0.3;
      const droop = 0.6 + (seed % 3) * 0.1;
      const length = 1.8 + (i % 2) * 0.6;

      const frondCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.cos(fAngle) * length * 0.5, 0.3, Math.sin(fAngle) * length * 0.5),
        new THREE.Vector3(Math.cos(fAngle) * length, -droop, Math.sin(fAngle) * length)
      );

      const stemGeo = new THREE.TubeGeometry(frondCurve, 6, 0.02, 3, false);
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x2d5a1e, roughness: 0.9 });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.copy(top);
      tree.add(stem);

      // Leaves
      for (let b = 0; b < 6; b++) {
        const bt = (b + 1) / 7;
        const point = frondCurve.getPoint(bt);
        const leafLen = 0.45 * (1 - bt * 0.4);
        const leafGeo = new THREE.PlaneGeometry(0.08, leafLen);
        leafGeo.translate(0, leafLen / 2, 0);
        const leafMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(0.28, 0.6, 0.22 + bt * 0.06),
          side: THREE.DoubleSide,
          roughness: 0.85
        });
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(top.x + point.x, top.y + point.y, top.z + point.z);
        leaf.rotation.set(droop * bt, fAngle + Math.PI / 2, (b % 2 === 0 ? 0.5 : -0.5));
        tree.add(leaf);
      }
    }

    // Coconuts
    for (let c = 0; c < 1 + (seed % 3); c++) {
      const ca = (c / 3) * Math.PI * 2;
      const cGeo = new THREE.SphereGeometry(0.08, 5, 5);
      const cMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.9 });
      const coconut = new THREE.Mesh(cGeo, cMat);
      coconut.position.set(top.x + Math.cos(ca) * 0.2, top.y - 0.2, top.z + Math.sin(ca) * 0.2);
      tree.add(coconut);
    }

    return tree;
  }

  addRocks(group, radius, seed) {
    const count = 2 + (seed % 4);
    for (let i = 0; i < count; i++) {
      const angle = ((i * 137.5 + seed * 0.7) % 360) * Math.PI / 180;
      const dist = radius * (0.75 + (i % 3) * 0.08);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const size = 0.3 + (seed + i) % 3 * 0.2;
      const geo = new THREE.DodecahedronGeometry(size, 1);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        pos.setY(v, pos.getY(v) * (0.4 + Math.random() * 0.3));
        pos.setX(v, pos.getX(v) * (0.8 + Math.random() * 0.4));
        pos.setZ(v, pos.getZ(v) * (0.8 + Math.random() * 0.4));
      }
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.06, 0.1, 0.4),
        roughness: 1.0
      });
      const rock = new THREE.Mesh(geo, mat);
      rock.position.set(x, 0.2, z);
      rock.rotation.set(i * 1.3, i * 0.7, i * 2.1);
      group.add(rock);
    }
  }

  updateIsland(island) {}
}
