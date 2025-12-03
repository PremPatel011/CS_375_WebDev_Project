import * as THREE from 'https://unpkg.com/three/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three/examples/jsm/controls/OrbitControls.js?module';
import { EffectComposer } from 'https://unpkg.com/three/examples/jsm/postprocessing/EffectComposer.js?module';
import { RenderPass } from 'https://unpkg.com/three/examples/jsm/postprocessing/RenderPass.js?module';
import { UnrealBloomPass } from 'https://unpkg.com/three/examples/jsm/postprocessing/UnrealBloomPass.js?module';

// show overlay error so failures are visible
function showErrorOverlay(msg) {
  try {
    let el = document.getElementById('island_error_overlay');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'island_error_overlay';
      Object.assign(el.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: 99999,
        background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '12px',
        borderRadius: '8px', maxWidth: '45vw', maxHeight: '45vh',
        overflow: 'auto', fontSize: '12px', lineHeight: '1.2',
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
  } catch (e) {
    console.error('Failed to show error overlay', e);
  }
}

(async function main() {
  try {
    const params = new URLSearchParams(window.location.search);
    const viewUser = params.get('viewUser');

    // dynamic import for SimplexNoise (handles exports differences)
    let SimplexNoiseClass = null;
    try {
      const mod = await import('https://unpkg.com/three/examples/jsm/math/SimplexNoise.js');
      SimplexNoiseClass = mod.SimplexNoise || mod.default || mod.SimplexNoiseDefault || mod;
    } catch (e) {
      console.warn('SimplexNoise dynamic import failed', e);
      SimplexNoiseClass = null;
    }

    // deterministic PRNG helpers
    function hashStringToUint32(s) {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    }
    function mulberry32(a) {
      let t = a >>> 0;
      return function() {
        t |= 0;
        t = (t + 0x6D2B79F5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    }

    async function fetchPublicAudio(userId) {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/spotify-top`);
        if (!res.ok) return null;
        const data = await res.json();
        const feats = (data.tracks || []).map(t => t.audio_features || t.audioFeatures || (t.track && t.track.audio_features)).filter(Boolean);
        if (feats.length) {
          const keys = ['acousticness','danceability','energy','instrumentalness','liveness','loudness','tempo','valence'];
          const avg = {};
          for (const k of keys) avg[k] = 0;
          for (const f of feats) for (const k of keys) avg[k] += (f[k] || 0);
          for (const k of keys) avg[k] = avg[k] / feats.length;
          return avg;
        }
        const trackCount = (data.tracks || []).length;
        const artistCount = (data.artists || []).length;
        return {
          acousticness: 0.33,
          danceability: Math.min(0.95, 0.4 + trackCount / 50),
          energy: Math.min(0.95, 0.45 + trackCount / 50),
          instrumentalness: 0.0,
          liveness: 0.15,
          loudness: -8.6,
          tempo: 120 + Math.min(20, Math.floor(trackCount / 2)),
          valence: Math.min(0.95, 0.35 + artistCount / 20)
        };
      } catch (e) {
        console.error('fetchPublicAudio error', e);
        return null;
      }
    }

    // defaults (safe fallback)
    let audio = {
      acousticness: 0.33, danceability: 0.57, energy: 0.56,
      instrumentalness: 0.0, liveness: 0.16, loudness: -8.6,
      tempo: 128, valence: 0.405
    };

    // prefer live owner's audio when viewer == owner, else public aggregate
    try {
      if (viewUser) {
        try {
          const meRes = await fetch('/api/me', { credentials: 'same-origin' });
          if (meRes.ok) {
            const me = await meRes.json();
            if (String(me.id) === String(viewUser)) {
              try {
                const userAudio = await initializeUserTracks(); // [`initializeUserTracks`](app/public/src/tracks.js)
                if (userAudio) audio = userAudio;
              } catch (e) {
                console.warn('initializeUserTracks failed, falling back to public', e);
                const pub = await fetchPublicAudio(viewUser);
                if (pub) audio = pub;
              }
            } else {
              const pub = await fetchPublicAudio(viewUser);
              if (pub) audio = pub;
            }
          } else {
            const pub = await fetchPublicAudio(viewUser);
            if (pub) audio = pub;
          }
        } catch (err) {
          console.error('Identity resolution error, using public', err);
          const pub = await fetchPublicAudio(viewUser);
          if (pub) audio = pub;
        }
      } else {
        try {
          const userAudio = await initializeUserTracks();
          if (userAudio) audio = userAudio;
        } catch (e) {
          console.warn('initializeUserTracks failed, using defaults', e);
        }
      }
    } catch (e) {
      console.warn('Audio resolution unexpected error', e);
    }

    // seeded PRNG — ensure same seed for the account whether viewing home or ?viewUser=<your id>
    let seededRandom = Math.random;
    try {
      let seedSource = null;
      if (viewUser) {
        // If viewing a specific user, check whether that user is the current viewer.
        try {
          const meRes2 = await fetch('/api/me', { credentials: 'same-origin' });
          if (meRes2.ok) {
            const me2 = await meRes2.json();
            if (String(me2.id) === String(viewUser)) {
              // same account — use the same 'me:<id>' seed as the home page
              seedSource = `me:${me2.id}`;
            }
          }
        } catch (e) { /* ignore */ }
        // if not the same viewer, fall back to user:<id>
        if (!seedSource) seedSource = `user:${viewUser}`;
      } else {
        // Home page: prefer an auth-stable seed (me:<id>) when available, else fall back to audio fingerprint
        try {
          const meRes2 = await fetch('/api/me', { credentials: 'same-origin' });
          if (meRes2.ok) {
            const me2 = await meRes2.json();
            seedSource = `me:${me2.id}`;
          }
        } catch (e) { /* ignore */ }
        if (!seedSource) {
          seedSource = `audio:${audio.loudness}|${audio.energy}|${audio.danceability}|${audio.tempo}|${audio.valence}`;
        }
      }

      const seed = hashStringToUint32(String(seedSource || 'default'));
      seededRandom = mulberry32(seed);
    } catch (e) {
      console.warn('Failed to create seeded PRNG', e);
      seededRandom = Math.random;
    }

    // color scheme derived from valence
    const islandColors = {};
    (function updateColors(valence) {
      const skyCold = new THREE.Color(0x7A8B9C), skyWarm = new THREE.Color(0xFFB584);
      islandColors.sky = skyCold.clone().lerp(skyWarm, valence);
      islandColors.sand = new THREE.Color(0xA0A8B0).clone().lerp(new THREE.Color(0xE8C170), valence);
      islandColors.grass = new THREE.Color(0x5B8B7D).clone().lerp(new THREE.Color(0xA8C256), valence);
      islandColors.grass2 = new THREE.Color(0x4A6B5B).clone().lerp(new THREE.Color(0x7B8E3D), valence);
      islandColors.rock = new THREE.Color(0x6B7B8C).clone().lerp(new THREE.Color(0xA0653F), valence);
      islandColors.mountain = new THREE.Color(0x3D4A5C).clone().lerp(new THREE.Color(0x5C3D2E), valence);
      islandColors.snow = new THREE.Color(0xD5E5F0).clone().lerp(new THREE.Color(0xFFEBD9), valence);
      islandColors.tree = new THREE.Color(0x2B5F5F).clone().lerp(new THREE.Color(0x6B8E23), valence);
      islandColors.ocean = new THREE.Color(0x2B5876).clone().lerp(new THREE.Color(0x48C9B0), valence);
    })(audio.valence || 0.4);

    // non-blocking: set top avatar if available
    (async function loadTopAvatar(){
      try {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        if (!res.ok) return;
        const p = await res.json();
        const img = document.getElementById('top_avatar');
        if (!img) return;
        if (p.profile_pic_url) { img.src = p.profile_pic_url; img.hidden = false; }
        else img.hidden = true;
      } catch (e) { console.error('loadTopAvatar', e); }
    })();

    // scene + renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(15, 25, 50);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace !== undefined) {
      try { renderer.outputColorSpace = THREE.SRGBColorSpace; } catch {}
    } else if ('outputEncoding' in renderer && THREE.sRGBEncoding !== undefined) {
      try { renderer.outputEncoding = THREE.sRGBEncoding; } catch {}
    }
    try { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.5; } catch {}

    document.body.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.update();

    scene.background = new THREE.Color(islandColors.sky);
    scene.add(new THREE.HemisphereLight(0x88ccff, 0x226622, 0.6));
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sunLight = new THREE.DirectionalLight(0xffeedd, 1.4);
    sunLight.position.set(10, 10, 5);
    sunLight.castShadow = true;
    sunLight.shadow.camera.left = -80; sunLight.shadow.camera.right = 80;
    sunLight.shadow.camera.top = 80; sunLight.shadow.camera.bottom = -80;
    sunLight.shadow.mapSize.width = 2048; sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.bias = -0.0005;
    sunLight.color.setHex(0xffddaa);
    scene.add(sunLight);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.85));

    // utility to create noise instance expected by code (SimplexNoise wants { random: fn })
    function makeNoise(seedRnd) {
      if (SimplexNoiseClass) {
        const rndArg = (typeof seedRnd === 'function') ? { random: seedRnd } : seedRnd;
        try { return new SimplexNoiseClass(rndArg); } catch (e) { console.warn('SimplexNoise ctor failed', e); }
      }
      return { noise: () => (seededRandom() - 0.5) * 2 };
    }

    function generateIsland() {
      const size = 200, segments = 128;
      const noise = makeNoise(seededRandom);

      const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
      const vertices = geometry.attributes.position.array;
      const colors = [];

      for (let i = 0; i < vertices.length; i += 3) {
        const x = vertices[i], y = vertices[i + 1];
        const loudness = (audio.loudness + 60) / 60;
        const dist = Math.sqrt(x * x + y * y);
        const maxDist = size * 0.5 * Math.max(0.01, loudness);
        const normDist = dist / Math.max(1e-6, maxDist);

        const edgeFalloff = Math.pow(Math.max(0, 1 - Math.pow(normDist, 2.2)), 1.2);
        const centerFalloff = 1.0 - Math.pow(normDist, 2.5);

        let height = 0, amplitude = 1.0, frequency = 0.015;
        for (let octave = 0; octave < 5; octave++) {
          const n = (typeof noise.noise === 'function') ? noise.noise(x * frequency, y * frequency) : 0;
          height += n * amplitude;
          amplitude *= 0.5;
          frequency *= 2.1;
        }
        height = height * edgeFalloff * 30 * (audio.energy || 0.5) * centerFalloff;
        if (height < 1) height *= 0.25;

        vertices[i + 2] = height;

        let color;
        if (height < 0.5) color = islandColors.sand;
        else if (height < 4) color = islandColors.grass;
        else if (height < 8) color = islandColors.grass2;
        else if (height < 12) color = islandColors.rock;
        else if (height < 16) color = islandColors.mountain;
        else color = islandColors.snow;

        colors.push(color.r, color.g, color.b);
      }

      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.3
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    const island = generateIsland();
    scene.add(island);

    // ocean
    const oceanGeometry = new THREE.PlaneGeometry(200, 200, 32, 32);
    const oceanMaterial = new THREE.MeshStandardMaterial({
      color: islandColors.ocean, flatShading: true, roughness: 0.4, metalness: 0.6, transparent: true, opacity: 0.85
    });
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = 0.5;
    ocean.receiveShadow = true;
    scene.add(ocean);

    // waves params from danceability
    const waveParams = {
      freqX: 0.05 + (audio.danceability * 0.15),
      freqY: 0.10 + (audio.danceability * 0.20),
      speedX: 0.5 + (audio.danceability * 1.5),
      speedY: 0.4 + (audio.danceability * 1.2),
      heightX: 0.5 + (audio.danceability * 1.5),
      heightY: 0.3 + (audio.danceability * 0.9)
    };

    function updateWaves(geometry, time, params) {
      const positions = geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1];
        const wave1 = Math.sin(x * params.freqX + time * params.speedX) * params.heightX;
        const wave2 = Math.sin(y * params.freqY + time * params.speedY) * params.heightY;
        positions[i + 2] = Math.max(0, wave1 + wave2);
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    // foliage & fireflies deterministic using seededRandom
    const treeGeometry = new THREE.ConeGeometry(0.8, 2.5, 3);
    const treeBaseColor = islandColors.tree;
    const positions = island.geometry.attributes.position.array;

    function addTrees() {
      for (let i = 0; i < positions.length; i += 3) {
        if (seededRandom() > 0.3 * (audio.acousticness || 0.33)) continue;
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (z < 1 || z >= 6) continue;
        const treeColor = treeBaseColor.clone ? treeBaseColor.clone() : new THREE.Color(treeBaseColor);
        if (typeof treeColor.offsetHSL === 'function') {
          treeColor.offsetHSL((seededRandom() - 0.5) * 0.05, 0, (seededRandom() - 0.5) * 0.1);
        }
        const treeMaterial = new THREE.MeshStandardMaterial({ color: treeColor, flatShading: true, roughness: 0.6, metalness: 0.3 });
        const tree = new THREE.Mesh(treeGeometry, treeMaterial);
        tree.position.set(x, y, z + 1);
        tree.rotation.x = Math.PI / 2;
        tree.rotation.y = seededRandom() * Math.PI * 2;
        tree.castShadow = true;
        tree.receiveShadow = true;
        island.add(tree);
      }
    }
    addTrees();

    function getFirefly() {
      const color = new THREE.Color(0xeabc3a);
      const geo = new THREE.SphereGeometry(0.02, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      const dir = new THREE.Vector3((seededRandom() - 0.5) * 2, 0, (seededRandom() - 0.5) * 2).normalize();
      mesh.userData = {
        basePos: mesh.position.clone(),
        phase: seededRandom() * Math.PI * 2,
        speed: 0.5 + seededRandom(),
        driftDir: dir,
        driftSpeed: 0.05 + seededRandom() * 0.05,
      };
      return mesh;
    }

    for (let i = 0; i < positions.length; i += 3) {
      if (seededRandom() > 0.2 * (audio.liveness || 0.15)) continue;
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (z < 1 || z > 10) continue;
      const ff = getFirefly();
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
        const flutter = Math.sin(t * speed + phase) * 0.1;
        const drift = Math.sin(t * driftSpeed + phase) * 0.2;
        const side = Math.cos(t * driftSpeed + phase) * 0.2;
        const horizontalDir = driftDir.clone().sub(islandUp.clone().multiplyScalar(driftDir.dot(islandUp))).normalize();
        const perpDir = new THREE.Vector3().crossVectors(islandUp, horizontalDir).normalize();
        obj.position.copy(basePos)
          .addScaledVector(islandUp, flutter)
          .addScaledVector(horizontalDir, drift)
          .addScaledVector(perpDir, side);
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.0 + phase);
        obj.material.opacity = 0.5 + 0.5 * pulse;
        obj.scale.setScalar(1.0 + 0.3 * pulse);
      });
    }

    function animate(time) {
      const t = time * 0.001;
      updateWaves(oceanGeometry, t, waveParams);
      controls.update();
      composer.render();
      requestAnimationFrame(animate);
      animateFireflies();
    }

    animate(0);

    // handle resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, true);
      try { composer.setSize(window.innerWidth, window.innerHeight); } catch {}
    }, { passive: true });

  } catch (err) {
    console.error('island.js initialization error', err);
    showErrorOverlay(String(err && (err.stack || err.message || err)));
  }
})();