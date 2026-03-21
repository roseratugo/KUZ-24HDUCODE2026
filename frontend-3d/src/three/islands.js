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

  getCoastDist(px, pz, worldRadius, seed) {
    const dist = Math.sqrt(px * px + pz * pz) / worldRadius;
    const angle = Math.atan2(pz, px);
    const coastNoise =
      noise2D(Math.cos(angle) * 1.8 + seed * 0.007, Math.sin(angle) * 1.8 + seed * 0.003) * 0.22 +
      noise2D(Math.cos(angle) * 4 + seed * 0.013, Math.sin(angle) * 4 + seed * 0.009) * 0.08;
    return dist - coastNoise;
  }

  getHeight(px, pz, worldCX, worldCZ, worldRadius, seed) {
    const shore = this.getCoastDist(px, pz, worldRadius, seed);
    const t = Math.max(0, 1 - shore);
    const profile = t * t * (3 - 2 * t); // smoothstep

    const wx = (px + worldCX) * 0.035;
    const wz = (pz + worldCZ) * 0.035;
    const terrainNoise =
      noise2D(wx, wz) * 1.2 +
      noise2D_2(wx * 2.5, wz * 2.5) * 0.5;

    const maxHeight = 5 + worldRadius * 0.12;
    let height = profile * maxHeight + terrainNoise * profile * profile * 1.0;

    // Smooth shore transition — gradually slope into water
    if (shore > 0.85 && shore <= 1.1) {
      const fade = (shore - 0.85) / 0.25;
      const smoothFade = fade * fade * (3 - 2 * fade);
      height = height * (1 - smoothFade) + (-1.5) * smoothFade;
    } else if (shore > 1.1) {
      height = -3;
    }

    return height;
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

    // --- Terrain mesh ---
    const segments = 80;
    const size = worldRadius * 2.6;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i);
      const pz = positions.getZ(i);

      const height = this.getHeight(px, pz, worldCX, worldCZ, worldRadius, seed);
      positions.setY(i, height);

      // Vertex colors with smooth gradients
      const color = new THREE.Color();
      if (height < -0.5) {
        // Underwater rock
        color.setRGB(0.15, 0.12, 0.1);
      } else if (height < 0.3) {
        // Wet sand at waterline
        const t = (height + 0.5) / 0.8;
        color.lerpColors(new THREE.Color(0x6b5a3e), new THREE.Color(0xd4b896), Math.max(0, t));
      } else if (height < 1.2) {
        // Dry sand / beach
        const t = (height - 0.3) / 0.9;
        color.lerpColors(new THREE.Color(0xf0ddb8), new THREE.Color(0xe8d5a0), t);
      } else if (height < 2.0) {
        // Sand to grass transition
        const t = (height - 1.2) / 0.8;
        color.lerpColors(new THREE.Color(0xc8c080), new THREE.Color(0x5a9a2a), t);
      } else if (height < 4.5) {
        // Lush grass
        const t = (height - 2.0) / 2.5;
        color.lerpColors(new THREE.Color(0x4a8a28), new THREE.Color(0x2d6b1a), t);
      } else {
        // Rocky top
        const t = Math.min(1, (height - 4.5) / 2);
        color.lerpColors(new THREE.Color(0x3a5a20), new THREE.Color(0x7a7a6a), t);
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Remove fully underwater triangles
    const index = geo.index;
    const newIndices = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      if (positions.getY(a) > -2 || positions.getY(b) > -2 || positions.getY(c) > -2) {
        newIndices.push(a, b, c);
      }
    }
    geo.setIndex(newIndices);

    const terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.02,
      side: THREE.DoubleSide
    }));
    terrainMesh.receiveShadow = true;
    group.add(terrainMesh);

    // --- Shallow water ring (transparent turquoise near shore) ---
    const shallowGeo = new THREE.RingGeometry(worldRadius * 0.8, worldRadius * 1.15, 48);
    shallowGeo.rotateX(-Math.PI / 2);
    // Deform ring to match coastline
    const sPos = shallowGeo.attributes.position;
    for (let i = 0; i < sPos.count; i++) {
      const sx = sPos.getX(i);
      const sz = sPos.getZ(i);
      const angle = Math.atan2(sz, sx);
      const dist = Math.sqrt(sx * sx + sz * sz);
      const coastNoise =
        noise2D(Math.cos(angle) * 1.8 + seed * 0.007, Math.sin(angle) * 1.8 + seed * 0.003) * 0.22 +
        noise2D(Math.cos(angle) * 4 + seed * 0.013, Math.sin(angle) * 4 + seed * 0.009) * 0.08;
      const deform = 1 + coastNoise * 0.5;
      sPos.setX(i, sx * deform);
      sPos.setZ(i, sz * deform);
    }
    shallowGeo.computeVertexNormals();

    const shallowMat = new THREE.MeshStandardMaterial({
      color: 0x1a998e,
      transparent: true,
      opacity: 0.25,
      roughness: 0.3,
      side: THREE.DoubleSide
    });
    const shallow = new THREE.Mesh(shallowGeo, shallowMat);
    shallow.position.y = 0.15;
    group.add(shallow);

    // --- Vegetation ---
    this.addPalmTrees(group, worldRadius, worldCX, worldCZ, seed);
    this.addBushes(group, worldRadius, worldCX, worldCZ, seed);
    this.addRocks(group, worldRadius, worldCX, worldCZ, seed);

    group.position.set(worldCX, 0, worldCZ);
    this.scene.add(group);
    this.islandMeshes.set(islandId, group);
  }

  addPalmTrees(group, radius, wx, wz, seed) {
    const count = Math.min(15, Math.floor(4 + radius * 0.3));
    for (let i = 0; i < count; i++) {
      const angle = ((i * 137.508 + seed) % 360) * Math.PI / 180;
      const dist = radius * (0.15 + Math.abs(noise2D(i * 0.5 + seed * 0.01, 0)) * 0.5);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const h = this.getHeight(x, z, wx, wz, radius, seed);
      if (h < 1.5 || h > 7) continue;

      const tree = this.createPalmTree(seed + i);
      tree.position.set(x, h - 0.3, z);
      tree.scale.setScalar(2.2 + Math.abs(noise2D(i, seed)) * 1.2);
      group.add(tree);
    }
  }

  createPalmTree(seed) {
    const tree = new THREE.Group();
    const trunkHeight = 3 + (seed % 3) * 0.5;
    const lean = 0.1 + (seed % 4) * 0.03;
    const leanDir = seed * 1.7;

    // Trunk with catmull-rom curve
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(leanDir) * lean, trunkHeight * 0.35, Math.sin(leanDir) * lean),
      new THREE.Vector3(Math.cos(leanDir) * lean * 2.2, trunkHeight * 0.7, Math.sin(leanDir) * lean * 2.2),
      new THREE.Vector3(Math.cos(leanDir) * lean * 2.5, trunkHeight, Math.sin(leanDir) * lean * 2.5),
    ]);

    const trunkGeo = new THREE.TubeGeometry(curve, 10, 0.14, 6, false);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x8B6914,
      roughness: 0.95
    });
    tree.add(new THREE.Mesh(trunkGeo, trunkMat));

    // Trunk rings (bark detail)
    for (let r = 0; r < 6; r++) {
      const t = r / 6;
      const p = curve.getPoint(t);
      const ringGeo = new THREE.TorusGeometry(0.16, 0.02, 4, 8);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x6b5010, roughness: 1 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(p);
      ring.rotation.x = Math.PI / 2;
      tree.add(ring);
    }

    const top = curve.getPoint(1);

    // Palm fronds — wide leaf shapes
    const frondCount = 7 + (seed % 3);
    for (let i = 0; i < frondCount; i++) {
      const fAngle = (i / frondCount) * Math.PI * 2 + seed * 0.3;
      const droop = 0.5 + (seed % 3) * 0.12;
      const length = 2.0 + (i % 2) * 0.5;

      // Frond shape — wide leaf using custom geometry
      const frondShape = new THREE.Shape();
      const steps = 10;
      // Top edge
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = t * length;
        const width = Math.sin(t * Math.PI) * 0.35;
        frondShape.lineTo(x, width);
      }
      // Bottom edge (back)
      for (let s = steps; s >= 0; s--) {
        const t = s / steps;
        const x = t * length;
        const width = -Math.sin(t * Math.PI) * 0.35;
        frondShape.lineTo(x, width);
      }

      const frondGeo = new THREE.ShapeGeometry(frondShape, 1);
      const frondMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.30 + (i % 3) * 0.015, 0.55, 0.25 + (i % 4) * 0.03),
        side: THREE.DoubleSide,
        roughness: 0.85
      });
      const frond = new THREE.Mesh(frondGeo, frondMat);
      frond.position.copy(top);
      frond.rotation.set(
        droop * 0.7,
        fAngle,
        -droop * 0.3 + (i % 2 ? 0.1 : -0.1)
      );
      tree.add(frond);

      // Central rib of each frond
      const ribCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(length * 0.5, 0.15, 0),
        new THREE.Vector3(length, -droop * 0.4, 0)
      );
      const ribGeo = new THREE.TubeGeometry(ribCurve, 6, 0.015, 3, false);
      const ribMat = new THREE.MeshStandardMaterial({ color: 0x3d6a1e, roughness: 0.9 });
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.position.copy(top);
      rib.rotation.set(droop * 0.7, fAngle, -droop * 0.3);
      tree.add(rib);
    }

    // Coconuts cluster
    const coconutCount = 1 + (seed % 3);
    for (let c = 0; c < coconutCount; c++) {
      const ca = (c / coconutCount) * Math.PI * 2 + seed * 0.5;
      const cGeo = new THREE.SphereGeometry(0.1, 6, 6);
      const cMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.9 });
      const coconut = new THREE.Mesh(cGeo, cMat);
      coconut.position.set(
        top.x + Math.cos(ca) * 0.22,
        top.y - 0.25,
        top.z + Math.sin(ca) * 0.22
      );
      tree.add(coconut);
    }

    return tree;
  }

  addBushes(group, radius, wx, wz, seed) {
    const count = Math.floor(6 + radius * 0.2);
    for (let i = 0; i < count; i++) {
      const angle = ((i * 97.3 + seed * 0.5) % 360) * Math.PI / 180;
      const dist = radius * (0.2 + Math.abs(noise2D(i * 0.7, seed * 0.02)) * 0.45);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const h = this.getHeight(x, z, wx, wz, radius, seed);
      if (h < 1.8 || h > 5) continue;

      const bushSize = 0.6 + Math.random() * 0.8;
      const bushGeo = new THREE.SphereGeometry(bushSize, 6, 5);
      // Squash vertically
      const bPos = bushGeo.attributes.position;
      for (let v = 0; v < bPos.count; v++) {
        bPos.setY(v, bPos.getY(v) * 0.6);
        bPos.setX(v, bPos.getX(v) + (Math.random() - 0.5) * 0.15);
        bPos.setZ(v, bPos.getZ(v) + (Math.random() - 0.5) * 0.15);
      }
      bushGeo.computeVertexNormals();

      const bushMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.28 + Math.random() * 0.06, 0.5, 0.18 + Math.random() * 0.1),
        roughness: 0.9
      });
      const bush = new THREE.Mesh(bushGeo, bushMat);
      bush.position.set(x, h, z);
      bush.scale.setScalar(1.5 + Math.random());
      group.add(bush);
    }
  }

  addRocks(group, radius, wx, wz, seed) {
    const count = 3 + (seed % 5);
    for (let i = 0; i < count; i++) {
      const angle = ((i * 137.5 + seed * 0.7) % 360) * Math.PI / 180;
      const dist = radius * (0.7 + (i % 3) * 0.1);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      const h = this.getHeight(x, z, wx, wz, radius, seed);

      const size = 0.5 + (seed + i) % 3 * 0.3;
      const geo = new THREE.DodecahedronGeometry(size, 1);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        pos.setY(v, pos.getY(v) * (0.4 + Math.random() * 0.3));
        pos.setX(v, pos.getX(v) * (0.7 + Math.random() * 0.5));
        pos.setZ(v, pos.getZ(v) * (0.7 + Math.random() * 0.5));
      }
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.06, 0.08, 0.38 + (i % 3) * 0.04),
        roughness: 1.0
      });
      const rock = new THREE.Mesh(geo, mat);
      rock.position.set(x, Math.max(0.2, h), z);
      rock.rotation.set(i * 1.3, i * 0.7, i * 2.1);
      rock.scale.setScalar(1.5);
      group.add(rock);
    }
  }

  updateIsland(island) {}
}
