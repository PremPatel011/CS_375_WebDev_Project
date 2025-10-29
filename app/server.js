const pg = require("pg");
const express = require("express");
const app = express();

const crypto = require('crypto');
const https = require('https');
const { URLSearchParams } = require('url');

// Need to match the Spotify redirect URI (http://127.0.0.1:8000/...)
const port = 8000;
const hostname = "127.0.0.1";

const env = require("../env.json");
const Pool = pg.Pool;
const pool = new Pool(env);
pool.connect().then(function () {
  console.log(`Connected to database ${env.database}`);
});

app.use(express.static("public"));
app.use(express.json()); 

// In-memory session store (testing out)
const sessions = new Map();

// Spotify config from env.json
const spotifyCfg = env.spotify || {};
const SPOTIFY_CLIENT_ID = spotifyCfg.clientId;
const SPOTIFY_CLIENT_SECRET = spotifyCfg.clientSecret;
const SPOTIFY_REDIRECT_URI = spotifyCfg.redirectUri;

// Start Spotify OAuth: redirect to Spotify authorize page
app.get('/auth/spotify', (req, res) => {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_REDIRECT_URI) {
    return res.status(500).send('Spotify not configured on server');
  }

  const state = crypto.randomBytes(16).toString('hex');
  sessions.set(state, { created: Date.now() });

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    scope: 'user-read-email user-read-private'
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

// helper: POST form to Spotify token endpoint
function postForm(url, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = new URLSearchParams(body).toString();
    const options = {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr)
      }, headers)
    };

    const req = https.request(url, options, (resp) => {
      let data = '';
      resp.on('data', (chunk) => data += chunk);
      resp.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// Spotify callback
app.get('/auth/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.status(400).send('Spotify authorization error');
  }
  if (!state || !sessions.has(state)) {
    return res.status(400).send('Invalid or missing state');
  }
  sessions.delete(state);

  try {
    const tokenResponse = await postForm('https://accounts.spotify.com/api/token', {
      'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
    }, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI
    });

    if (!tokenResponse || !tokenResponse.access_token) {
      console.error('Token response error', tokenResponse);
      return res.status(500).send('Failed to obtain access token from Spotify');
    }

    const accessToken = tokenResponse.access_token;

    // fetch Spotify profile
    const profile = await new Promise((resolve, reject) => {
      const options = { method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` } };
      https.get('https://api.spotify.com/v1/me', options, (r) => {
        let d = '';
        r.on('data', (c) => d += c);
        r.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

    if (!profile || !profile.id) {
      return res.status(500).send('Failed to fetch Spotify profile');
    }

    // create simple session and set cookie
    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions.set(sessionId, {
      auth: 'spotify',
      spotifyId: profile.id,
      displayName: profile.display_name || null,
      email: profile.email || null
    });

    res.setHeader('Set-Cookie', `sid=${sessionId}; HttpOnly; Path=/`);

    // redirect to main app page
    res.redirect('/garden.html');
  } catch (err) {
    console.error('Spotify callback error', err);
    res.status(500).send('Spotify login failed');
  }
});

app.listen(port, hostname, () => {
  console.log(`Listening at: http://${hostname}:${port}`);
});