
import * as THREE from 'https://unpkg.com/three/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three/examples/jsm/controls/OrbitControls.js?module';
import { SimplexNoise } from 'https://unpkg.com/three/examples/jsm/math/SimplexNoise.js';
import { EffectComposer } from 'https://unpkg.com/three/examples/jsm/postprocessing/EffectComposer.js?module';
import { RenderPass } from 'https://unpkg.com/three/examples/jsm/postprocessing/RenderPass.js?module';
import { UnrealBloomPass } from 'https://unpkg.com/three/examples/jsm/postprocessing/UnrealBloomPass.js?module';

const audio1 = await initializeUserTracks();
console.log(audio1);

const audio = {
  acousticness: 0.32965413636363644, // amount of trees
  danceability: 0.5708636363636365, // waves
  energy: 0.565090909090909, // terrain height
  instrumentalness: 0.0003148740909090909,
  liveness: 0.16130000000000003,
  loudness: -8.615727272727272, // island size
  tempo: 128.14995454545453,
  valence: 0.4056954545454545 // color pallete, weather?
}

let islandColors = {
  sky: new THREE.Color(0x65C1BC),
  sand: new THREE.Color(0xCBBD93),
  grass: new THREE.Color(0x7EB26D),
  grass2: new THREE.Color(0x568248),
  rock: new THREE.Color(0x6B4F36),
  mountain: new THREE.Color(0x4B3A2B),
  snow: new THREE.Color(0xF3F6FB),
  tree: new THREE.Color(0x2E6F40),
  ocean: new THREE.Color(0x3a9bd4)
}

// Top-left profile avatar: fetch /api/me and show if available
async function loadTopAvatar() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return; // not authenticated or no avatar
    const p = await res.json();
    const img = document.getElementById('top_avatar');
    if (!img) return;
    if (p.profile_pic_url) {
      img.src = p.profile_pic_url;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
  } catch (e) {
    console.error('loadTopAvatar error', e);
  }
}
loadTopAvatar();

function updateColors(valence) {
  const skyCold = new THREE.Color(0x7A8B9C);     // cool gray-blue
  const skyWarm = new THREE.Color(0xFFB584);     // warm peachy orange
  islandColors.sky = skyCold.clone().lerp(skyWarm, valence);
  
  const sandCold = new THREE.Color(0xA0A8B0);    // cool gray-blue sand
  const sandWarm = new THREE.Color(0xE8C170);    // warm golden sand
  islandColors.sand = sandCold.clone().lerp(sandWarm, valence);
  
  const grassCold = new THREE.Color(0x5B8B7D);   // teal-green
  const grassWarm = new THREE.Color(0xA8C256);   // warm yellow-green
  islandColors.grass = grassCold.clone().lerp(grassWarm, valence);
  
  const grass2Cold = new THREE.Color(0x4A6B5B);  // cool blue-green
  const grass2Warm = new THREE.Color(0x7B8E3D);  // warm olive
  islandColors.grass2 = grass2Cold.clone().lerp(grass2Warm, valence);
  
  const rockCold = new THREE.Color(0x6B7B8C);    // slate gray
  const rockWarm = new THREE.Color(0xA0653F);    // terracotta
  islandColors.rock = rockCold.clone().lerp(rockWarm, valence);
  
  const mountainCold = new THREE.Color(0x3D4A5C); // dark blue-gray
  const mountainWarm = new THREE.Color(0x5C3D2E);  // dark warm brown
  islandColors.mountain = mountainCold.clone().lerp(mountainWarm, valence);
  
  const snowCold = new THREE.Color(0xD5E5F0);    // icy blue-white
  const snowWarm = new THREE.Color(0xFFEBD9);    // warm peachy white
  islandColors.snow = snowCold.clone().lerp(snowWarm, valence);
  
  const treeCold = new THREE.Color(0x2B5F5F);    // cool blue-green
  const treeWarm = new THREE.Color(0x6B8E23);    // warm amber-green
  islandColors.tree = treeCold.clone().lerp(treeWarm, valence);
  
  const oceanCold = new THREE.Color(0x2B5876);   // cool deep blue
  const oceanWarm = new THREE.Color(0x48C9B0);   // warm turquoise
  islandColors.ocean = oceanCold.clone().lerp(oceanWarm, valence);
}

updateColors(audio.valence);

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
// controls.maxDistance = 100;
// controls.minDistance = 50;
// controls.maxPolarAngle = Math.PI/2.2;
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.update();

scene.background = new THREE.Color(islandColors.sky);

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

function generateIsland() {
  const size = 200;
  const segments = 128;
  const noise = new SimplexNoise();

  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  const vertices = geometry.attributes.position.array;
  const colors = [];

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];

    let loudness = (audio.loudness + 60) / 60;

    const dist = Math.sqrt(x * x + y * y);
    const maxDist = size * 0.5 * loudness;
    const normDist = dist / maxDist;

    const edgeFalloff = Math.pow(Math.max(0, 1 - Math.pow(normDist, 2.2)), 1.2);
    const centerFalloff = 1.0 - Math.pow(normDist, 2.5);

    let height = 0;
    let amplitude = 1.0;
    let frequency = 0.015;

    for (let octave = 0; octave < 5; octave++) {
      height += noise.noise(x * frequency, y * frequency) * amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }

    // scale overall height by edgeFalloff for island taper
    // scale noise amplitude by centerFalloff for smoother center
    height = height * edgeFalloff * 30 * audio.energy * centerFalloff;

    // sharper peaks - add a nonlinear boost like height = Math.pow(height, 1.3) after computing.

    // raise a bit to avoid too low center
    if (height < 1) height *= 0.25;

    vertices[i + 2] = height;

    let color = new THREE.Color();
    if (height < 0.5) {
      color = islandColors.sand;
    } else if (height < 4) {
      color = islandColors.grass;
    } else if (height < 8) {
      color = islandColors.grass2;
    } else if (height < 12) {
      color = islandColors.rock;
    } else if (height < 16) {
      color = islandColors.mountain;
    } else {
      color = islandColors.snow;
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
                                  color: islandColors.ocean, 
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

function updateWaveParamsFromDanceability(danceability) {
  // Higher danceability = faster, choppier waves with more frequency
  waveParams.freqX = 0.05 + (danceability * 0.15);     // 0.05 to 0.20
  waveParams.freqY = 0.10 + (danceability * 0.20);     // 0.10 to 0.30
  
  waveParams.speedX = 0.5 + (danceability * 1.5);      // 0.5 to 2.0
  waveParams.speedY = 0.4 + (danceability * 1.2);      // 0.4 to 1.6
  
  // Higher danceability = more wave height variation
  waveParams.heightX = 0.5 + (danceability * 1.5);     // 0.5 to 2.0
  waveParams.heightY = 0.3 + (danceability * 0.9);     // 0.3 to 1.2
}



// danceability
const waveParams = {
  // freqX: 0.1,
  // speedX: 1.0,
  // heightX: 1.0,
  // freqY: 0.15, 
  // speedY: 0.8,
  // heightY: 0.5,

  freqX: 0.05 + (audio.danceability * 0.15),     // 0.05 to 0.20
  freqY: 0.10 + (audio.danceability * 0.20),     // 0.10 to 0.30
  speedX: 0.5 + (audio.danceability * 1.5),      // 0.5 to 2.0
  speedY: 0.4 + (audio.danceability * 1.2),      // 0.4 to 1.6
  heightX: 0.5 + (audio.danceability * 1.5),     // 0.5 to 2.0
  heightY: 0.3 + (audio.danceability * 0.9)      // 0.3 to 1.2
};

// generate trees/foliage, density based on instrumentalness
const treeGeometry = new THREE.ConeGeometry(0.8, 2.5, 3);
const treeBaseColor = islandColors.tree;
const positions = island.geometry.attributes.position.array;
function addTrees() {
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.random() > 0.3 * audio.acousticness) continue; // instrumentalness/acoustiness ?

    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (z < 1 || z >= 6) continue;

    const treeColor = treeBaseColor.clone();
    treeColor.offsetHSL(
      (Math.random() - 0.5) * 0.05,
      0,
      (Math.random() - 0.5) * 0.1
    );

    const treeMaterial = new THREE.MeshStandardMaterial({
      color: treeColor,
      flatShading: true,
      roughness: 0.6,
      metalness: 0.3,
    });

    const tree = new THREE.Mesh(treeGeometry, treeMaterial); // vary size?
    tree.position.set(x, y, z + 1);
    tree.rotation.x = Math.PI / 2;
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.castShadow = true;
    tree.receiveShadow = true;

    island.add(tree);
  }
}

addTrees();

// liveness - fireflies, particles, birds? SCRAP

function getFirefly() {
  const hue = 0.6 + Math.random() * 0.2;
  // const color = new THREE.Color().setHSL(hue, 1, 0.6);
  const color = new THREE.Color(0xeabc3a);
  const geo = new THREE.SphereGeometry(0.02, 8, 8);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  const mesh = new THREE.Mesh(geo, mat);

  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * 2,
    0,
    (Math.random() - 0.5) * 2
  ).normalize();

  mesh.userData = {
    basePos: mesh.position.clone(),
    phase: Math.random() * Math.PI * 2,
    speed: 0.5 + Math.random(),
    driftDir: dir,
    driftSpeed: 0.05 + Math.random() * 0.05, // slow wander
  };

  return mesh;
}

for (let i = 0; i < positions.length; i += 3) {
  let liveness = 1;
  if (Math.random() > 0.2 * liveness) continue;

  const x = positions[i];
  const y = positions[i + 1];
  const z = positions[i + 2];

  if (z < 1 || z > 10) continue;

  let ff = getFirefly();
  ff.position.set(x, y, z + 0.5);
  ff.userData.basePos = ff.position.clone();
  island.add(ff);
}

const clock = new THREE.Clock();
const tmpQuat = new THREE.Quaternion();
const islandUp = new THREE.Vector3();

function animateFireflies() {
  const t = clock.getElapsedTime();

  island.getWorldQuaternion(tmpQuat);
  islandUp.set(0, 1, 0).applyQuaternion(tmpQuat);

  island.traverse(obj => {
    if (!obj.isMesh || !obj.userData.basePos) return;
    const { basePos, phase, speed, driftDir, driftSpeed } = obj.userData;

    // vertical flutter along island's up vector
    const flutter = Math.sin(t * speed + phase) * 0.1;

    // horizontal wandering offset (small circle or figure-8 pattern)
    const drift = Math.sin(t * driftSpeed + phase) * 0.2;
    const side = Math.cos(t * driftSpeed + phase) * 0.2;

    // Create a horizontal plane perpendicular to island's up vector
    // Project driftDir onto this plane to get a proper horizontal direction
    const horizontalDir = driftDir.clone().sub(
      islandUp.clone().multiplyScalar(driftDir.dot(islandUp))
    ).normalize();
    
    // Create perpendicular horizontal vector
    const perpDir = new THREE.Vector3().crossVectors(islandUp, horizontalDir).normalize();

    // combine all offsets
    obj.position.copy(basePos)
      .addScaledVector(islandUp, flutter)
      .addScaledVector(horizontalDir, drift)
      .addScaledVector(perpDir, side);

    // pulse brightness and scale
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.0 + phase);
    obj.material.opacity = 0.5 + 0.5 * pulse;
    obj.scale.setScalar(1.0 + 0.3 * pulse);
  });
}

// weather


function animate(time) {
  const t = time * 0.001;
  
  updateWaves(oceanGeometry, t, waveParams);
  
  controls.update();

  // renderer.render(scene, camera);
  composer.render();
  requestAnimationFrame(animate);
  animateFireflies();
}

animate(0);