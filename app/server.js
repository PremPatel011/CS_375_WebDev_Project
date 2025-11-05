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


const sessions = new Map();

function getSessionFromReq(req) {
  const cookie = req.headers && req.headers.cookie;
  if (!cookie) return null;
  const sidPair = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  if (!sidPair) return null;
  const sid = sidPair.split('=')[1];
  return sessions.get(sid) || null;
}

// attach session to req
app.use((req, res, next) => {
  req.session = getSessionFromReq(req);
  next();
});

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

    let user;
    try {
      const upsertSql = `
        INSERT INTO users (spotify_id, username, display_name, email, profile_pic_url, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (spotify_id) DO UPDATE SET
          -- preserve any custom username: only replace if it's NULL or still equal to the spotify_id
          username = CASE
            WHEN users.username IS NULL OR users.username = users.spotify_id THEN EXCLUDED.username
            ELSE users.username
          END,
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          profile_pic_url = EXCLUDED.profile_pic_url,
          updated_at = now()
        RETURNING id, spotify_id, username, display_name, email, profile_pic_url;
      `;
      const imageUrl = (profile.images && profile.images[0] && profile.images[0].url) || null;
      const values = [
        profile.id,
        profile.id, // default username — we can let user change this later
        profile.display_name || null,
        profile.email || null,
        imageUrl
      ];

      const result = await pool.query(upsertSql, values);
      user = result.rows[0];
    } catch (dbErr) {
      console.error('DB upsert error', dbErr);
      return res.status(500).send('Failed to save user profile');
    }

    // create simple session and set cookie
    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions.set(sessionId, {
      auth: 'spotify',
      spotifyId: profile.id,
      userId: user.id,
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

// GET current user's profile (private)
app.get('/api/me', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const q = `SELECT id, spotify_id, username, display_name, email, profile_pic_url, bio
               FROM users WHERE id = $1`;
    const result = await pool.query(q, [sess.userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/me error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update current user's editable fields (username, display_name, profile_pic_url, bio)
app.put('/api/me', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  const allowed = ['username', 'display_name', 'profile_pic_url', 'bio'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const key of allowed) {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates.push(`${key} = $${idx}`);
      values.push(req.body[key]);
      idx++;
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

  values.push(sess.userId); // final param
  const sql = `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING id, spotify_id, username, display_name, profile_pic_url, bio`;
  try {
    const result = await pool.query(sql, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/me error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET public profile (by user id) — excludes email
app.get('/api/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const q = `SELECT id, username, display_name, profile_pic_url, bio FROM users WHERE id = $1`;
    const result = await pool.query(q, [userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/users/:id error', err);
    res.status(500).json({ error: 'Server error' });
  }
});


app.listen(port, hostname, () => {
  console.log(`Listening at: http://${hostname}:${port}`);
});