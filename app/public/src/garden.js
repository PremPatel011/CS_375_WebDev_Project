
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight, true);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls( camera, renderer.domElement );
camera.position.set(15, 10, 20);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.update();

scene.background = new THREE.Color(0x65C1BC);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(10, 10, 5);
scene.add(directionalLight);

// island
const islandGeometry = new THREE.BoxGeometry(20, 20, 20);
const islandMaterial = new THREE.MeshToonMaterial( { color: 0x5C4327 } );
const island = new THREE.Mesh(islandGeometry, islandMaterial);
scene.add(island);

// ocean controlled by danceability
const oceanGeometry = new THREE.PlaneGeometry(100, 100, 50, 50);
const oceanMaterial = new THREE.MeshToonMaterial( { color: 0x006994 } );
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
ocean.rotation.x = -Math.PI/2;
scene.add(ocean);

function updateWaves(geometry, time, params) {
  const positions = geometry.attributes.position.array;
  
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    
    const wave1 = Math.sin(x * params.freqX + time * params.speedX) * params.heightX;
    const wave2 = Math.sin(y * params.freqY + time * params.speedY) * params.heightY;
    
    positions[i + 2] = wave1 + wave2;
  }
  
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
}

// danceability
const waveParams = {
  freqX: 0.1,
  speedX: 1.0,
  heightX: 2.0,
  freqY: 0.15, 
  speedY: 0.8,
  heightY: 1.5
};


function animate(time) {
  const t = time * 0.001;
  
  updateWaves(oceanGeometry, t, waveParams);
  
  controls.update();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate(0);