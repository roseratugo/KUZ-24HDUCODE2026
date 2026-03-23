/**
 * Chargement du modele 3D du bateau (GLTF)
 *
 * Charge le modele "vogmerry" depuis /models/vogmerry/scene.gltf
 * Auto-scale le modele pour qu'il tienne dans une bounding box de 30 unites.
 * Ajoute un PointLight rouge (#e94560) au-dessus du bateau pour l'eclairage ambiant.
 * En cas d'erreur de chargement, le code appelant (scene.js) utilise un cube brun comme fallback.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function loadBoat() {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      '/models/vogmerry/scene.gltf',
      (gltf) => {
        const model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 30 / maxDim;
        model.scale.setScalar(scale);

        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center.multiplyScalar(scale));

        model.rotation.y = Math.PI / 2;

        const group = new THREE.Group();
        group.add(model);

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
