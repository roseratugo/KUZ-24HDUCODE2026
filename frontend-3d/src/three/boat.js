import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function loadBoat() {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      '/models/vogmerry/scene.gltf',
      (gltf) => {
        const model = gltf.scene;

        // Compute bounding box to auto-scale
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 30 / maxDim; // Target ~30 units
        model.scale.setScalar(scale);

        // Center the model
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center.multiplyScalar(scale));

        // Rotate model 180° so it faces forward
        model.rotation.y = Math.PI;

        // Wrap in a group for easy positioning
        const group = new THREE.Group();
        group.add(model);

        // Add a subtle point light
        const light = new THREE.PointLight(0xe94560, 2, 20);
        light.position.set(0, 5, 0);
        group.add(light);

        console.log('Ship model loaded');
        resolve(group);
      },
      undefined,
      (error) => {
        console.error('Failed to load ship model:', error);
        reject(error);
      }
    );
  });
}
