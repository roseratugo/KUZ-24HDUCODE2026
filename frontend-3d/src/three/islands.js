import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();
const noise2D_2 = createNoise2D();

// Island types by cell count
// TINY: 1-2 cells (just a rock/sandbar)
// SMALL: 3-15 cells (small island)
// MEDIUM: 16-49 cells (medium island)
// LARGE: 50+ cells (big island)

export class IslandManager {
  constructor(scene, cellSize) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.islandMeshes = new Map();
    this.sandCells = new Map();
    this.dirty = false;
    this.rebuildTimer = null;
    this.lastHash = '';
  }

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
    if (cell.type !== 'SAND' && !cell.island) return;
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
      visited.add(key);

      while (queue.length > 0) {
        const k = queue.shift();
        const c = this.sandCells.get(k);
        if (c) cluster.push(c);

        const [cx, cy] = k.split(',').map(Number);
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

  rebuildAll() {
    const clusters = this.findClusters();

    // Quick hash to avoid unnecessary rebuilds
    const hash = clusters.map(c => c.length).sort().join(',');
    if (hash === this.lastHash) return;
    this.lastHash = hash;

    // Clear all
    for (const [, mesh] of this.islandMeshes) {
      this.scene.remove(mesh);
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.islandMeshes.clear();

    clusters.forEach((cells, i) => {
      const size = cells.length;
      if (size <= 2) {
        this.buildTiny(i, cells);
      } else if (size <= 15) {
        this.buildSmall(i, cells);
      } else if (size < 50) {
        this.buildMedium(i, cells);
      } else {
        this.buildLarge(i, cells);
      }
    });

    console.log(`Built ${clusters.length} island(s): ${this.sandCells.size} cells`);
  }

  getCenter(cells) {
    const xs = cells.map(c => c.x);
    const ys = cells.map(c => c.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const spanX = Math.max(...xs) - Math.min(...xs) + 1;
    const spanY = Math.max(...ys) - Math.min(...ys) + 1;
    const radius = Math.max(spanX, spanY) / 2 + 1;
    return {
      cx, cy,
      wx: cx * this.cellSize,
      wz: -cy * this.cellSize,
      radius,
      worldRadius: radius * this.cellSize,
      seed: Math.abs(Math.round(cx * 137 + cy * 311)) % 10000
    };
  }

  // ===== TINY: 1-2 cells — just a rock/sandbar =====
  buildTiny(id, cells) {
    const { wx, wz, seed } = this.getCenter(cells);
    const group = new THREE.Group();

    // Simple rock/sandbar
    const geo = new THREE.DodecahedronGeometry(this.cellSize * 0.6, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, pos.getY(i) * 0.3 + Math.abs(pos.getY(i)) * 0.1);
      pos.setX(i, pos.getX(i) * (0.8 + Math.random() * 0.4));
      pos.setZ(i, pos.getZ(i) * (0.8 + Math.random() * 0.4));
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: seed % 2 === 0 ? 0xc4a060 : 0x6b6b5e,
      roughness: 0.95
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.5;
    group.add(mesh);

    group.position.set(wx, 0, wz);
    this.scene.add(group);
    this.islandMeshes.set(id, group);
  }

  // ===== SMALL: 3-15 cells — small island with few trees =====
  buildSmall(id, cells) {
    const { wx, wz, worldRadius, seed } = this.getCenter(cells);
    const group = new THREE.Group();

    const segments = 24;
    const geo = new THREE.PlaneGeometry(worldRadius * 2.2, worldRadius * 2.2, segments, segments);
    geo.rotateX(-Math.PI / 2);

    this.applyTerrainHeight(geo, wx, wz, worldRadius, seed, 3);
    this.applyVertexColors(geo);
    this.cullUnderwaterFaces(geo);

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide
    }));
    group.add(mesh);

    // 1-3 palm trees
    const treeCount = 1 + (seed % 3);
    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + seed;
      const dist = worldRadius * 0.2;
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      const h = this.sampleHeight(tx, tz, wx, wz, worldRadius, seed, 3);
      if (h > 1) {
        const tree = this.createPalmTree(seed + i);
        tree.position.set(tx, h - 0.2, tz);
        tree.scale.setScalar(1.8 + (seed % 3) * 0.3);
        group.add(tree);
      }
    }

    group.position.set(wx, 0, wz);
    this.scene.add(group);
    this.islandMeshes.set(id, group);
  }

  // ===== MEDIUM: 16-49 cells — proper island =====
  buildMedium(id, cells) {
    const { wx, wz, worldRadius, seed } = this.getCenter(cells);
    const group = new THREE.Group();

    const segments = 40;
    const geo = new THREE.PlaneGeometry(worldRadius * 2.4, worldRadius * 2.4, segments, segments);
    geo.rotateX(-Math.PI / 2);

    this.applyTerrainHeight(geo, wx, wz, worldRadius, seed, 5);
    this.applyVertexColors(geo);
    this.cullUnderwaterFaces(geo);

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide
    }));
    group.add(mesh);

    // Palm trees
    const treeCount = 4 + (seed % 5);
    for (let i = 0; i < treeCount; i++) {
      const angle = ((i * 137.508 + seed) % 360) * Math.PI / 180;
      const dist = worldRadius * (0.15 + Math.abs(noise2D(i * 0.5, seed * 0.01)) * 0.45);
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      const h = this.sampleHeight(tx, tz, wx, wz, worldRadius, seed, 5);
      if (h > 1.5) {
        const tree = this.createPalmTree(seed + i);
        tree.position.set(tx, h - 0.3, tz);
        tree.scale.setScalar(2.0 + Math.abs(noise2D(i, seed)) * 1.0);
        group.add(tree);
      }
    }

    // Bushes
    this.addBushes(group, worldRadius, wx, wz, seed, 4);

    // Rocks
    this.addRocks(group, worldRadius, wx, wz, seed, 2);

    group.position.set(wx, 0, wz);
    this.scene.add(group);
    this.islandMeshes.set(id, group);
  }

  // ===== LARGE: 50+ cells — big island with lots of detail =====
  buildLarge(id, cells) {
    const { wx, wz, worldRadius, seed } = this.getCenter(cells);
    const group = new THREE.Group();

    const segments = 64;
    const geo = new THREE.PlaneGeometry(worldRadius * 2.4, worldRadius * 2.4, segments, segments);
    geo.rotateX(-Math.PI / 2);

    this.applyTerrainHeight(geo, wx, wz, worldRadius, seed, 7);
    this.applyVertexColors(geo);
    this.cullUnderwaterFaces(geo);

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide
    }));
    group.add(mesh);

    // Shallow water ring
    const shallowGeo = new THREE.RingGeometry(worldRadius * 0.85, worldRadius * 1.1, 32);
    shallowGeo.rotateX(-Math.PI / 2);
    const shallowMat = new THREE.MeshStandardMaterial({
      color: 0x1a998e, transparent: true, opacity: 0.2, roughness: 0.3, side: THREE.DoubleSide
    });
    const shallow = new THREE.Mesh(shallowGeo, shallowMat);
    shallow.position.y = 0.15;
    group.add(shallow);

    // Many palm trees
    const treeCount = Math.min(20, 6 + Math.floor(worldRadius * 0.2));
    for (let i = 0; i < treeCount; i++) {
      const angle = ((i * 137.508 + seed) % 360) * Math.PI / 180;
      const dist = worldRadius * (0.1 + Math.abs(noise2D(i * 0.5, seed * 0.01)) * 0.55);
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      const h = this.sampleHeight(tx, tz, wx, wz, worldRadius, seed, 7);
      if (h > 1.5) {
        const tree = this.createPalmTree(seed + i);
        tree.position.set(tx, h - 0.3, tz);
        tree.scale.setScalar(2.5 + Math.abs(noise2D(i, seed)) * 1.2);
        group.add(tree);
      }
    }

    // Bushes & rocks
    this.addBushes(group, worldRadius, wx, wz, seed, 8);
    this.addRocks(group, worldRadius, wx, wz, seed, 4);

    group.position.set(wx, 0, wz);
    this.scene.add(group);
    this.islandMeshes.set(id, group);
  }

  // ===== Shared terrain functions =====

  applyTerrainHeight(geo, wx, wz, worldRadius, seed, maxHeight) {
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i);
      const pz = positions.getZ(i);
      const h = this.sampleHeight(px, pz, wx, wz, worldRadius, seed, maxHeight);
      positions.setY(i, h);
    }
    geo.computeVertexNormals();
  }

  sampleHeight(px, pz, wx, wz, worldRadius, seed, maxHeight) {
    const dist = Math.sqrt(px * px + pz * pz) / worldRadius;
    const angle = Math.atan2(pz, px);

    // Organic coastline
    const coastNoise =
      noise2D(Math.cos(angle) * 1.8 + seed * 0.007, Math.sin(angle) * 1.8 + seed * 0.003) * 0.22 +
      noise2D(Math.cos(angle) * 4 + seed * 0.013, Math.sin(angle) * 4 + seed * 0.009) * 0.08;
    const shore = dist - coastNoise;

    const t = Math.max(0, 1 - shore);
    const profile = t * t * (3 - 2 * t);

    const nx = (px + wx) * 0.035;
    const nz = (pz + wz) * 0.035;
    const terrainNoise = noise2D(nx, nz) * 1.2 + noise2D_2(nx * 2.5, nz * 2.5) * 0.5;

    let height = profile * maxHeight + terrainNoise * profile * profile * 1.0;

    if (shore > 0.85 && shore <= 1.1) {
      const fade = (shore - 0.85) / 0.25;
      const sf = fade * fade * (3 - 2 * fade);
      height = height * (1 - sf) + (-1.5) * sf;
    } else if (shore > 1.1) {
      height = -3;
    }

    return height;
  }

  applyVertexColors(geo) {
    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const h = positions.getY(i);
      const color = new THREE.Color();

      if (h < -0.5) {
        color.setRGB(0.15, 0.12, 0.1);
      } else if (h < 0.3) {
        color.lerpColors(new THREE.Color(0x6b5a3e), new THREE.Color(0xd4b896), Math.max(0, (h + 0.5) / 0.8));
      } else if (h < 1.2) {
        color.lerpColors(new THREE.Color(0xf0ddb8), new THREE.Color(0xe8d5a0), (h - 0.3) / 0.9);
      } else if (h < 2.0) {
        color.lerpColors(new THREE.Color(0xc8c080), new THREE.Color(0x5a9a2a), (h - 1.2) / 0.8);
      } else if (h < 4.5) {
        color.lerpColors(new THREE.Color(0x4a8a28), new THREE.Color(0x2d6b1a), (h - 2.0) / 2.5);
      } else {
        color.lerpColors(new THREE.Color(0x3a5a20), new THREE.Color(0x7a7a6a), Math.min(1, (h - 4.5) / 2));
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  cullUnderwaterFaces(geo) {
    const positions = geo.attributes.position;
    const index = geo.index;
    const newIndices = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      if (positions.getY(a) > -2 || positions.getY(b) > -2 || positions.getY(c) > -2) {
        newIndices.push(a, b, c);
      }
    }
    geo.setIndex(newIndices);
  }

  // ===== Vegetation =====

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
    tree.add(new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.95 })));

    const top = curve.getPoint(1);

    // Fronds — simple wide shapes
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

      const frondGeo = new THREE.ShapeGeometry(frondShape, 1);
      const frondMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.30 + (i % 3) * 0.015, 0.55, 0.25),
        side: THREE.DoubleSide, roughness: 0.85
      });
      const frond = new THREE.Mesh(frondGeo, frondMat);
      frond.position.copy(top);
      frond.rotation.set(droop * 0.7, fAngle, -droop * 0.3);
      tree.add(frond);
    }

    return tree;
  }

  addBushes(group, radius, wx, wz, seed, count) {
    for (let i = 0; i < count; i++) {
      const angle = ((i * 97.3 + seed * 0.5) % 360) * Math.PI / 180;
      const dist = radius * (0.2 + Math.abs(noise2D(i * 0.7, seed * 0.02)) * 0.45);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const h = this.sampleHeight(x, z, wx, wz, radius, seed, 5);
      if (h < 1.8 || h > 5) continue;

      const bushGeo = new THREE.SphereGeometry(0.6 + Math.random() * 0.5, 5, 4);
      const bPos = bushGeo.attributes.position;
      for (let v = 0; v < bPos.count; v++) {
        bPos.setY(v, bPos.getY(v) * 0.6);
      }
      bushGeo.computeVertexNormals();

      const bush = new THREE.Mesh(bushGeo, new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.28, 0.5, 0.2 + Math.random() * 0.08),
        roughness: 0.9
      }));
      bush.position.set(x, h, z);
      bush.scale.setScalar(1.5);
      group.add(bush);
    }
  }

  addRocks(group, radius, wx, wz, seed, count) {
    for (let i = 0; i < count; i++) {
      const angle = ((i * 137.5 + seed * 0.7) % 360) * Math.PI / 180;
      const dist = radius * (0.7 + (i % 3) * 0.1);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const h = this.sampleHeight(x, z, wx, wz, radius, seed, 5);

      const geo = new THREE.DodecahedronGeometry(0.5 + (seed + i) % 3 * 0.2, 0);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        pos.setY(v, pos.getY(v) * 0.4);
      }
      geo.computeVertexNormals();

      const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x5a5a50, roughness: 1.0
      }));
      rock.position.set(x, Math.max(0.2, h), z);
      rock.rotation.set(i * 1.3, i * 0.7, i * 2.1);
      rock.scale.setScalar(1.5);
      group.add(rock);
    }
  }

  updateIsland(island) {}
}
