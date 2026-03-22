import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();
const noise2D_2 = createNoise2D();

// Size categories
const TINY = 'tiny';     // 1-2 cells
const SMALL = 'small';   // 3-15 cells
const MEDIUM = 'medium'; // 16-49 cells
const LARGE = 'large';   // 50+ cells

function getCategory(cellCount) {
  if (cellCount <= 2) return TINY;
  if (cellCount <= 15) return SMALL;
  if (cellCount < 50) return MEDIUM;
  return LARGE;
}

export class IslandManager {
  constructor(scene, cellSize) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.sandCells = new Map();
    this.islandMeshes = new Map(); // clusterId -> THREE.Group
    this.templates = new Map(); // category -> THREE.Group (source template)
    this.dirty = false;
    this.rebuildTimer = null;
    this.lastHash = '';

    // Shared materials (avoid creating duplicates per mesh)
    this._sharedMaterials = {
      terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.95 }),
      bush: new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.28, 0.5, 0.22), roughness: 0.9 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x5a5a50, roughness: 1.0 }),
      sand: new THREE.MeshStandardMaterial({ color: 0xc4a060, roughness: 0.95 }),
      shallow: new THREE.MeshStandardMaterial({ color: 0x1a998e, transparent: true, opacity: 0.2, roughness: 0.3, side: THREE.DoubleSide }),
      fronds: [],
    };
    // Pre-create 3 frond material variants
    for (let i = 0; i < 3; i++) {
      this._sharedMaterials.fronds.push(new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.30 + i * 0.015, 0.55, 0.25),
        side: THREE.DoubleSide, roughness: 0.85
      }));
    }

    // Reusable Color objects for terrain generation
    this._tmpColor = new THREE.Color();
    this._tmpColorA = new THREE.Color();
    this._tmpColorB = new THREE.Color();

    // Pre-generate templates
    this.generateTemplates();
  }

  generateTemplates() {
    this.templates.set(TINY, this.createTinyTemplate());
    this.templates.set(SMALL, this.createSmallTemplate());
    this.templates.set(MEDIUM, this.createMediumTemplate());
    this.templates.set(LARGE, this.createLargeTemplate());
  }

  // ===== Templates (generated once) =====

  createTinyTemplate() {
    const group = new THREE.Group();
    const geo = new THREE.DodecahedronGeometry(0.6, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, pos.getY(i) * 0.3);
      pos.setX(i, pos.getX(i) * (0.8 + Math.random() * 0.4));
      pos.setZ(i, pos.getZ(i) * (0.8 + Math.random() * 0.4));
    }
    geo.computeVertexNormals();
    const mat = this._sharedMaterials.sand;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.5;
    group.add(mesh);
    return group;
  }

  createSmallTemplate() {
    const group = new THREE.Group();
    const worldRadius = this.cellSize * 2.5;
    const seed = 42;

    const geo = this.createTerrainGeo(worldRadius, 24, seed, 3);
    group.add(new THREE.Mesh(geo, this.createTerrainMaterial()));

    // 2 palm trees
    for (let i = 0; i < 2; i++) {
      const angle = (i / 2) * Math.PI * 2 + 0.5;
      const tree = this.createPalmTree(seed + i);
      tree.position.set(Math.cos(angle) * worldRadius * 0.2, 2, Math.sin(angle) * worldRadius * 0.2);
      tree.scale.setScalar(2.0);
      group.add(tree);
    }

    return group;
  }

  createMediumTemplate() {
    const group = new THREE.Group();
    const worldRadius = this.cellSize * 5;
    const seed = 137;

    const geo = this.createTerrainGeo(worldRadius, 40, seed, 5);
    group.add(new THREE.Mesh(geo, this.createTerrainMaterial()));

    // 5 trees
    for (let i = 0; i < 5; i++) {
      const angle = ((i * 137.508) % 360) * Math.PI / 180;
      const dist = worldRadius * (0.15 + (i % 3) * 0.12);
      const tree = this.createPalmTree(seed + i);
      tree.position.set(Math.cos(angle) * dist, 3, Math.sin(angle) * dist);
      tree.scale.setScalar(2.2 + (i % 2) * 0.5);
      group.add(tree);
    }

    // Bushes
    for (let i = 0; i < 3; i++) {
      const angle = ((i * 97 + 50) % 360) * Math.PI / 180;
      const dist = worldRadius * 0.3;
      const bush = this.createBush();
      bush.position.set(Math.cos(angle) * dist, 2.5, Math.sin(angle) * dist);
      group.add(bush);
    }

    // Rocks
    for (let i = 0; i < 2; i++) {
      const rock = this.createRock(i);
      rock.position.set((i - 0.5) * worldRadius * 0.6, 0.5, worldRadius * 0.7);
      group.add(rock);
    }

    return group;
  }

  createLargeTemplate() {
    const group = new THREE.Group();
    const worldRadius = this.cellSize * 9;
    const seed = 311;

    const geo = this.createTerrainGeo(worldRadius, 64, seed, 7);
    group.add(new THREE.Mesh(geo, this.createTerrainMaterial()));

    // Shallow water ring
    const shallowGeo = new THREE.RingGeometry(worldRadius * 0.85, worldRadius * 1.1, 32);
    shallowGeo.rotateX(-Math.PI / 2);
    const shallow = new THREE.Mesh(shallowGeo, this._sharedMaterials.shallow);
    shallow.position.y = 0.15;
    group.add(shallow);

    // 12 trees
    for (let i = 0; i < 12; i++) {
      const angle = ((i * 137.508 + seed) % 360) * Math.PI / 180;
      const dist = worldRadius * (0.1 + (i % 4) * 0.12);
      const tree = this.createPalmTree(seed + i);
      tree.position.set(Math.cos(angle) * dist, 3.5 + (i % 3), Math.sin(angle) * dist);
      tree.scale.setScalar(2.5 + (i % 3) * 0.4);
      group.add(tree);
    }

    // Bushes
    for (let i = 0; i < 6; i++) {
      const angle = ((i * 60 + 30) % 360) * Math.PI / 180;
      const dist = worldRadius * (0.2 + (i % 3) * 0.1);
      const bush = this.createBush();
      bush.position.set(Math.cos(angle) * dist, 2.5 + (i % 2), Math.sin(angle) * dist);
      bush.scale.setScalar(1.2 + (i % 2) * 0.5);
      group.add(bush);
    }

    // Rocks
    for (let i = 0; i < 4; i++) {
      const angle = ((i * 90 + 45) % 360) * Math.PI / 180;
      const rock = this.createRock(i);
      rock.position.set(Math.cos(angle) * worldRadius * 0.75, 0.3, Math.sin(angle) * worldRadius * 0.75);
      group.add(rock);
    }

    return group;
  }

  // ===== Terrain generation =====

  createTerrainGeo(worldRadius, segments, seed, maxHeight) {
    const size = worldRadius * 2.4;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i);
      const pz = positions.getZ(i);
      const dist = Math.sqrt(px * px + pz * pz) / worldRadius;
      const angle = Math.atan2(pz, px);

      const coastNoise =
        noise2D(Math.cos(angle) * 1.8 + seed * 0.007, Math.sin(angle) * 1.8 + seed * 0.003) * 0.22 +
        noise2D(Math.cos(angle) * 4 + seed * 0.013, Math.sin(angle) * 4 + seed * 0.009) * 0.08;
      const shore = dist - coastNoise;

      const t = Math.max(0, 1 - shore);
      const profile = t * t * (3 - 2 * t);

      const nx = px * 0.035;
      const nz = pz * 0.035;
      const terrainNoise = noise2D(nx + seed * 0.1, nz + seed * 0.1) * 1.2 +
        noise2D_2(nx * 2.5 + seed * 0.1, nz * 2.5 + seed * 0.1) * 0.5;

      let height = profile * maxHeight + terrainNoise * profile * profile;

      if (shore > 0.85 && shore <= 1.1) {
        const fade = (shore - 0.85) / 0.25;
        const sf = fade * fade * (3 - 2 * fade);
        height = height * (1 - sf) + (-1.5) * sf;
      } else if (shore > 1.1) {
        height = -3;
      }

      positions.setY(i, height);

      // Vertex colors — reuse pre-allocated Color objects
      const color = this._tmpColor;
      const ca = this._tmpColorA;
      const cb = this._tmpColorB;
      if (height < -0.5) color.setRGB(0.15, 0.12, 0.1);
      else if (height < 0.3) color.lerpColors(ca.set(0x6b5a3e), cb.set(0xd4b896), Math.max(0, (height + 0.5) / 0.8));
      else if (height < 1.2) color.lerpColors(ca.set(0xf0ddb8), cb.set(0xe8d5a0), (height - 0.3) / 0.9);
      else if (height < 2.0) color.lerpColors(ca.set(0xc8c080), cb.set(0x5a9a2a), (height - 1.2) / 0.8);
      else if (height < 4.5) color.lerpColors(ca.set(0x4a8a28), cb.set(0x2d6b1a), (height - 2.0) / 2.5);
      else color.lerpColors(ca.set(0x3a5a20), cb.set(0x7a7a6a), Math.min(1, (height - 4.5) / 2));

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Cull underwater
    const index = geo.index;
    const newIndices = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      if (positions.getY(a) > -2 || positions.getY(b) > -2 || positions.getY(c) > -2) {
        newIndices.push(a, b, c);
      }
    }
    geo.setIndex(newIndices);

    return geo;
  }

  createTerrainMaterial() {
    return this._sharedMaterials.terrain;
  }

  // ===== Vegetation (generated once per template) =====

  createPalmTree(seed) {
    const tree = new THREE.Group();
    const trunkHeight = 3 + (seed % 3) * 0.5;
    const lean = 0.1 + (seed % 4) * 0.03;
    const leanDir = seed * 1.7;

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(leanDir) * lean, trunkHeight * 0.4, Math.sin(leanDir) * lean),
      new THREE.Vector3(Math.cos(leanDir) * lean * 2.2, trunkHeight * 0.7, Math.sin(leanDir) * lean * 2.2),
      new THREE.Vector3(Math.cos(leanDir) * lean * 2.5, trunkHeight, Math.sin(leanDir) * lean * 2.5),
    ]);

    const trunkGeo = new THREE.TubeGeometry(curve, 6, 0.14, 5, false);
    tree.add(new THREE.Mesh(trunkGeo, this._sharedMaterials.trunk));

    const top = curve.getPoint(1);
    const frondCount = 6;
    for (let i = 0; i < frondCount; i++) {
      const fAngle = (i / frondCount) * Math.PI * 2 + seed * 0.3;
      const droop = 0.5 + (seed % 3) * 0.12;
      const length = 2.0;

      const frondShape = new THREE.Shape();
      for (let s = 0; s <= 8; s++) {
        const t = s / 8;
        frondShape.lineTo(t * length, Math.sin(t * Math.PI) * 0.35);
      }
      for (let s = 8; s >= 0; s--) {
        const t = s / 8;
        frondShape.lineTo(t * length, -Math.sin(t * Math.PI) * 0.35);
      }

      const frond = new THREE.Mesh(
        new THREE.ShapeGeometry(frondShape, 1),
        this._sharedMaterials.fronds[i % 3]
      );
      frond.position.copy(top);
      frond.rotation.set(droop * 0.7, fAngle, -droop * 0.3);
      tree.add(frond);
    }

    return tree;
  }

  createBush() {
    const geo = new THREE.SphereGeometry(0.6, 5, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * 0.6);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, this._sharedMaterials.bush);
  }

  createRock(seed) {
    const geo = new THREE.DodecahedronGeometry(0.5 + (seed % 3) * 0.2, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * 0.4);
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, this._sharedMaterials.rock);
    rock.scale.setScalar(1.5);
    return rock;
  }

  // ===== Cell management =====

  setShipPosition(sx, sy, radius) {
    let removed = false;
    for (const [key, cell] of this.sandCells) {
      const dx = cell.x - sx;
      const dy = cell.y - sy;
      if (dx * dx + dy * dy > radius * radius * 1.3) {
        this.sandCells.delete(key);
        removed = true;
      }
    }
    if (removed) {
      this.dirty = true;
      this.scheduleRebuild();
    }
  }

  addCell(cell) {
    if (cell.type !== 'SAND') return;
    const key = `${cell.x},${cell.y}`;
    if (this.sandCells.has(key)) return;
    this.sandCells.set(key, cell);
    this.dirty = true;
    this.scheduleRebuild();
  }

  scheduleRebuild() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      if (!this.dirty) return;
      this.dirty = false;
      this.rebuildAll();
    }, 500);
  }

  findClusters() {
    const visited = new Set();
    const clusters = [];

    for (const [key] of this.sandCells) {
      if (visited.has(key)) continue;
      const cluster = [];
      const queue = [key];
      let qIdx = 0; // index-based queue avoids O(n) shift()
      visited.add(key);

      while (qIdx < queue.length) {
        const k = queue[qIdx++];
        const c = this.sandCells.get(k);
        if (c) cluster.push(c);

        const commaIdx = k.indexOf(',');
        const cx = +k.substring(0, commaIdx);
        const cy = +k.substring(commaIdx + 1);
        for (const nk of [
          `${cx-1},${cy}`, `${cx+1},${cy}`, `${cx},${cy-1}`, `${cx},${cy+1}`,
          `${cx-1},${cy-1}`, `${cx+1},${cy-1}`, `${cx-1},${cy+1}`, `${cx+1},${cy+1}`
        ]) {
          if (!visited.has(nk) && this.sandCells.has(nk)) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }
      if (cluster.length > 0) clusters.push(cluster);
    }
    return clusters;
  }

  // Helper to compute min/max without spread (avoids stack overflow on large arrays)
  _minMax(cells) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    return { minX, maxX, minY, maxY };
  }

  // Dispose a group's geometries (materials are shared, don't dispose them)
  _disposeGroup(group) {
    group.traverse(child => {
      if (child.isMesh && child.geometry) {
        child.geometry.dispose();
      }
    });
  }

  rebuildAll() {
    const clusters = this.findClusters();

    // Hash: sorted list of "category:cx:cy" to detect changes
    const hashParts = [];
    for (let i = 0; i < clusters.length; i++) {
      const cells = clusters[i];
      const cat = getCategory(cells.length);
      const { minX, maxX, minY, maxY } = this._minMax(cells);
      const cx = Math.round((minX + maxX) / 2);
      const cy = Math.round((minY + maxY) / 2);
      hashParts.push(`${cat}:${cx}:${cy}`);
    }
    const hash = hashParts.sort().join('|');

    if (hash === this.lastHash) return;
    this.lastHash = hash;

    // Clear existing — dispose geometries to free GPU memory
    for (const [, mesh] of this.islandMeshes) {
      this.scene.remove(mesh);
      this._disposeGroup(mesh);
    }
    this.islandMeshes.clear();

    // Place clones
    for (let i = 0; i < clusters.length; i++) {
      const cells = clusters[i];
      const cat = getCategory(cells.length);
      const template = this.templates.get(cat);
      if (!template) continue;

      const { minX, maxX, minY, maxY } = this._minMax(cells);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const clone = template.clone();

      // Scale based on actual cluster size vs template size
      const spanX = maxX - minX + 1;
      const spanY = maxY - minY + 1;
      const actualRadius = Math.max(spanX, spanY) / 2 + 1;

      let templateRadius;
      if (cat === TINY) templateRadius = 1;
      else if (cat === SMALL) templateRadius = 2.5;
      else if (cat === MEDIUM) templateRadius = 5;
      else templateRadius = 9;

      const scale = actualRadius / templateRadius;
      clone.scale.setScalar(scale);

      // Random Y rotation for variety
      clone.rotation.y = (centerX * 137 + centerY * 311) % (Math.PI * 2);

      clone.position.set(
        centerX * this.cellSize,
        0,
        -centerY * this.cellSize
      );

      this.scene.add(clone);
      this.islandMeshes.set(i, clone);
    }
  }

  updateIsland(island) {}
}
