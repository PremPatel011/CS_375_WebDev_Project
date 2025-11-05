
import * as THREE from 'https://unpkg.com/three@latest/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@latest/examples/jsm/controls/OrbitControls.js?module';
import { SimplexNoise } from 'https://unpkg.com/three@latest/examples/jsm/math/SimplexNoise.js';
import { EffectComposer } from 'https://unpkg.com/three/examples/jsm/postprocessing/EffectComposer.js?module';
import { RenderPass } from 'https://unpkg.com/three/examples/jsm/postprocessing/RenderPass.js?module';
import { UnrealBloomPass } from 'https://unpkg.com/three/examples/jsm/postprocessing/UnrealBloomPass.js?module';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(15, 25, 50);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight, true);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls( camera, renderer.domElement );
controls.maxDistance = 100;
controls.minDistance = 50;
controls.maxPolarAngle = Math.PI/2.2;
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.update();

scene.background = new THREE.Color(0x65C1BC);

const envLight = new THREE.HemisphereLight(0x88ccff, 0x226622, 0.6);
scene.add(envLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 1.4);
sunLight.position.set(10, 10, 5);
sunLight.castShadow = true;
sunLight.shadow.camera.left = -80;
sunLight.shadow.camera.right = 80;
sunLight.shadow.camera.top = 80;
sunLight.shadow.camera.bottom = -80;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;

sunLight.shadow.bias = -0.0005;
sunLight.color.setHex(0xffddaa);

scene.add(sunLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.85);
composer.addPass(bloom);

// scene.fog = new THREE.Fog(0x87ceeb, 12, 225);

// island scale based on loudness, island mountain heights based on energy or terrain based on energy in genereal
function generateIsland(loudness, energy) {
  const size = 200;
  const segments = 128;
  const noise = new SimplexNoise();

  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  const vertices = geometry.attributes.position.array;
  const colors = [];

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];

    const dist = Math.sqrt(x * x + y * y);
    const maxDist = size * 0.3; // loudness
    const normDist = dist / maxDist;

    const edgeFalloff = Math.pow(Math.max(0, 1 - Math.pow(normDist, 2.2)), 1.2);
    const centerFalloff = 1.0 - Math.pow(normDist, 2.5);

    let height = 0;
    let amplitude = 1.0; // energy?
    let frequency = 0.015; // energy? lower = flatter

    for (let octave = 0; octave < 5; octave++) {
      height += noise.noise(x * frequency, y * frequency) * amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }

    // scale overall height by edgeFalloff for island taper
    // scale noise amplitude by centerFalloff for smoother center
    height = height * edgeFalloff * 15 * centerFalloff; // flatter - lower the constant

    // sharper peaks - add a nonlinear boost like height = Math.pow(height, 1.3) after computing.

    // raise a bit to avoid too low center
    if (height < 1) height *= 0.25;

    vertices[i + 2] = height;

    const color = new THREE.Color();
    if (height < 0.5) {
      color.setHex(0xCBBD93); // sand
    } else if (height < 4) {
      color.setHex(0x7EB26D); // grass
    } else if (height < 8) {
      color.setHex(0x568248); // darker greens
    } else if (height < 12) {
      color.setHex(0x6B4F36); // rocky 
    } else if (height < 16) {
      color.setHex(0x4B3A2B); // mountain
    } else {
      color.setHex(0xF3F6FB); // snow
    }

    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.6,
    metalness: 0.3,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}

const island = generateIsland();
scene.add(island);

// ocean controlled by danceability
const oceanGeometry = new THREE.PlaneGeometry(200, 200, 32, 32);
const oceanMaterial = new THREE.MeshStandardMaterial({ 
                                  color: 0x3a9bd4, 
                                  flatShading: true,
                                  roughness: 0.4,
                                  metalness: 0.6,
                                  transparent: true,
                                  opacity: 0.85
                                });
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
ocean.rotation.x = -Math.PI/2;
ocean.position.y = 0.5;
ocean.receiveShadow = true;
scene.add(ocean);

function updateWaves(geometry, time, params) {
  const positions = geometry.attributes.position.array;
  
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    
    const wave1 = Math.sin(x * params.freqX + time * params.speedX) * params.heightX;
    const wave2 = Math.sin(y * params.freqY + time * params.speedY) * params.heightY;
    
    positions[i + 2] = Math.max(0, wave1 + wave2);
  }
  
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
}

// danceability
const waveParams = {
  freqX: 0.1,
  speedX: 1.0,
  heightX: 1.0,
  freqY: 0.15, 
  speedY: 0.8,
  heightY: 0.5,
};

// generate trees/foliage
const treeGeometry = new THREE.ConeGeometry( 1, 2.5, 3 );
const treeMaterial = new THREE.MeshStandardMaterial( { 
  color: 0x2E6F40,
  flatShading: true,
  roughness: 0.8,
  metalness: 0.3,
} );



function createGrassBundle() {
  const bundle = new THREE.Group();
  const bladeCount = 10; // number of blades per patch

  const bladeGeometry = new THREE.PlaneGeometry(0.05, 0.4);
  const bladeMaterial = new THREE.MeshToonMaterial({
    color: 0x3fa34d,
    side: THREE.DoubleSide,
  });

  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);

    // random offset within the patch
    blade.position.x = (Math.random() - 0.5) * 0.2;
    blade.position.z = (Math.random() - 0.5) * 0.2;

    // random tilt and rotation
    blade.rotation.y = Math.random() * Math.PI;
    // blade.rotation.x = (Math.random() - 0.3) * 0.1;

    blade.rotation.x = -Math.PI/2;

    // varied height
    blade.scale.y = 0.8 + Math.random() * 0.5;

    bundle.add(blade);
  }

  return bundle;
}

const positions = island.geometry.attributes.position.array;

for (let i = 0; i < positions.length; i += 3) {

  if ((Math.random() * 100) > 10) continue; // spread out

  const x = positions[i];
  const y = positions[i + 1];
  const z = positions[i + 2];

  if (z < 1 || z >= 6) continue; // trees go lower?

  const tree = new THREE.Mesh(treeGeometry, treeMaterial);
  tree.position.set(x, y, z+1);

  // const grass = createGrassBundle();
  // grass.position.set(x, y, z);

  tree.rotation.x = Math.PI/2;
  tree.castShadow = true;
  tree.receiveShadow = true;

  island.add(tree);
}

// liveness - fireflies, particles, birds

function animate(time) {
  const t = time * 0.001;
  
  updateWaves(oceanGeometry, t, waveParams);
  
  controls.update();

  // renderer.render(scene, camera);
  composer.render();
  requestAnimationFrame(animate);
}

animate(0);