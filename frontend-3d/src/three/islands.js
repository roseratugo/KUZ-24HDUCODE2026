import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();

export class IslandManager {
  constructor(scene, cellSize) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.meshes = new Map();
    this.islandGroups = new Map(); // islandId -> group of cells
    this.sandCells = new Map();
  }

  addCell(cell) {
    const key = `${cell.x},${cell.y}`;
    if (this.meshes.has(key)) return;

    if (cell.type === 'SAND') {
      this.createSandCell(cell);
      this.sandCells.set(key, cell);
    }

    if (cell.island) {
      const islandId = cell.island.id || cell.island.name;
      if (!this.islandGroups.has(islandId)) {
        this.islandGroups.set(islandId, []);
      }
      this.islandGroups.get(islandId).push(cell);
      this.rebuildIsland(islandId);
    }
  }

  createSandCell(cell) {
    const key = `${cell.x},${cell.y}`;
    const x = cell.x * this.cellSize;
    const z = -cell.y * this.cellSize;

    // Create terrain with noise
    const segments = 4;
    const geometry = new THREE.PlaneGeometry(this.cellSize, this.cellSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i) + x;
      const pz = positions.getZ(i) + z;
      const height = this.getTerrainHeight(px, pz);
      positions.setY(i, height);
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xd4a574,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0, z);
    mesh.receiveShadow = true;

    this.scene.add(mesh);
    this.meshes.set(key, mesh);

    // Add some vegetation randomly
    if (Math.random() > 0.5) {
      this.addVegetation(x, z);
    }
  }

  getTerrainHeight(x, z) {
    const scale = 0.05;
    const height = noise2D(x * scale, z * scale) * 2
      + noise2D(x * scale * 2, z * scale * 2) * 1
      + noise2D(x * scale * 4, z * scale * 4) * 0.5;
    return Math.max(0.5, height + 2);
  }

  addVegetation(x, z) {
    const count = Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < count; i++) {
      const ox = x + (Math.random() - 0.5) * this.cellSize * 0.8;
      const oz = z + (Math.random() - 0.5) * this.cellSize * 0.8;
      const h = this.getTerrainHeight(ox, oz);

      if (Math.random() > 0.4) {
        this.createPalmTree(ox, h, oz);
      } else {
        this.createRock(ox, h, oz);
      }
    }
  }

  createPalmTree(x, y, z) {
    const tree = new THREE.Group();

    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.25, 3, 5);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B6914,
      roughness: 0.9,
      flatShading: true
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 1.5;
    // Slight curve
    trunk.rotation.x = (Math.random() - 0.5) * 0.2;
    trunk.rotation.z = (Math.random() - 0.5) * 0.2;
    tree.add(trunk);

    // Leaves (low poly cones)
    const leafCount = 5;
    for (let i = 0; i < leafCount; i++) {
      const leafGeometry = new THREE.ConeGeometry(1.2, 1.5, 4);
      const leafMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.28 + Math.random() * 0.05, 0.7, 0.35),
        roughness: 0.8,
        flatShading: true
      });
      const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
      const angle = (i / leafCount) * Math.PI * 2;
      leaf.position.set(
        Math.cos(angle) * 0.5,
        3 + Math.random() * 0.3,
        Math.sin(angle) * 0.5
      );
      leaf.rotation.x = 0.5 + Math.random() * 0.3;
      leaf.rotation.y = angle;
      tree.add(leaf);
    }

    tree.position.set(x, y, z);
    tree.scale.setScalar(0.6 + Math.random() * 0.4);
    this.scene.add(tree);
  }

  createRock(x, y, z) {
    const geometry = new THREE.DodecahedronGeometry(
      0.3 + Math.random() * 0.5,
      0
    );
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0, 0, 0.35 + Math.random() * 0.15),
      roughness: 0.95,
      flatShading: true
    });
    const rock = new THREE.Mesh(geometry, material);
    rock.position.set(x, y + 0.2, z);
    rock.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    this.scene.add(rock);
  }

  rebuildIsland(islandId) {
    // Could add a label/marker for the island
  }

  updateIsland(island) {
    if (island.islandId) {
      this.islandGroups.set(island.islandId, island);
    }
  }
}
