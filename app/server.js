const pg = require("pg");
const express = require("express");
const app = express();

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
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
app.use(express.json({ limit: '8mb' }))

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
    scope: 'user-read-email user-read-private user-top-read'
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
          username = CASE
            WHEN users.username IS NULL OR users.username = users.spotify_id THEN EXCLUDED.username
            ELSE users.username
          END,
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          profile_pic_url = CASE
            WHEN users.profile_pic_url IS NULL OR users.profile_pic_url NOT LIKE '/uploads/%' THEN EXCLUDED.profile_pic_url
            ELSE users.profile_pic_url
          END,
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

    // store tokens (if present)
    if (tokenResponse.access_token) {
      const expiresIn = tokenResponse.expires_in || 3600;
      const sessObj = sessions.get(sessionId);
      sessObj.accessToken = tokenResponse.access_token;
      sessObj.refreshToken = tokenResponse.refresh_token || sessObj.refreshToken || null;
      sessObj.expiresAt = Date.now() + expiresIn * 1000; // ms
      sessions.set(sessionId, sessObj);
    }

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

// Add avatar upload endpoint
app.post('/api/me/avatar', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  const imageData = req.body && req.body.image;
  if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:')) {
    return res.status(400).json({ error: 'Invalid image payload' });
  }

  const matches = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'Malformed data URL' });

  const mime = matches[1]; // e.g. image/png
  const base64 = matches[2];
   
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  const buffer = Buffer.from(base64, 'base64');

  try {
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Use deterministic filename per user to avoid duplicate files
    const filename = `avatar_${sess.userId}.${ext}`;
    const filepath = path.join(uploadsDir, filename);

    // Remove any previous avatar files for this user with different extensions or timestamps
    const files = fs.readdirSync(uploadsDir);
    for (const f of files) {
      if (f.startsWith(`avatar_${sess.userId}`) && f !== filename) {
        try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) { /* ignore */ }
      }
    }

    fs.writeFileSync(filepath, buffer);
    const publicUrl = `/uploads/${filename}`;

    // update DB (persist the local uploads URL)
    const sql = `UPDATE users SET profile_pic_url = $1, updated_at = now() WHERE id = $2 RETURNING profile_pic_url`;
    const result = await pool.query(sql, [publicUrl, sess.userId]);

    // return the exact publicUrl we wrote
    res.json({ profile_pic_url: result.rows[0].profile_pic_url || publicUrl });
  } catch (err) {
    console.error('Avatar save error', err);
    res.status(500).json({ error: 'Failed to save avatar' });
  }

});

// Create a new post for the current user
app.post('/api/posts', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  const content = (req.body && req.body.content ? req.body.content : '').trim();
  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const q = `INSERT INTO posts (user_id, content) VALUES ($1, $2)
               RETURNING id, content, created_at`;
    const result = await pool.query(q, [sess.userId, content]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/posts error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all posts (with comments) for the current user
app.get('/api/posts', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const postsResult = await pool.query(
      `SELECT id, content, created_at
       FROM posts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [sess.userId]
    );

    const posts = postsResult.rows;
    if (posts.length === 0) {
      return res.json([]);
    }

    const postIds = posts.map((p) => p.id);
    const commentsResult = await pool.query(
      `SELECT c.id, c.post_id, c.content, c.created_at,
              u.username AS author_username,
              u.display_name AS author_display_name
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ANY($1::int[])
       ORDER BY c.created_at ASC`,
      [postIds]
    );

    const commentsByPost = new Map();
    for (const row of commentsResult.rows) {
      if (!commentsByPost.has(row.post_id)) {
        commentsByPost.set(row.post_id, []);
      }
      commentsByPost.get(row.post_id).push({
        id: row.id,
        content: row.content,
        created_at: row.created_at,
        author_username: row.author_username,
        author_display_name: row.author_display_name
      });
    }

    const withComments = posts.map((post) => ({
      id: post.id,
      content: post.content,
      created_at: post.created_at,
      comments: commentsByPost.get(post.id) || []
    }));

    res.json(withComments);
  } catch (err) {
    console.error('GET /api/posts error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a comment to a post
app.post('/api/posts/:postId/comments', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  const postId = parseInt(req.params.postId, 10);
  if (Number.isNaN(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const content = (req.body && req.body.content ? req.body.content : '').trim();
  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const postExists = await pool.query(
      `SELECT id FROM posts WHERE id = $1`,
      [postId]
    );
    if (postExists.rowCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const q = `INSERT INTO comments (post_id, user_id, content)
               VALUES ($1, $2, $3)
               RETURNING id, content, created_at`;
    const result = await pool.query(q, [postId, sess.userId, content]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/posts/:postId/comments error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// helper to refresh access token
async function refreshAccessTokenIfNeeded(sess) {
  if (!sess || !sess.refreshToken) return sess;
  if (sess.expiresAt && Date.now() < sess.expiresAt - 30000) return sess; // still valid (30s buffer)

  // refresh
  try {
    const resp = await postForm('https://accounts.spotify.com/api/token', {
      'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
    }, {
      grant_type: 'refresh_token',
      refresh_token: sess.refreshToken
    });
    if (resp && resp.access_token) {
      sess.accessToken = resp.access_token;
      const expiresIn = resp.expires_in || 3600;
      sess.expiresAt = Date.now() + expiresIn * 1000;
      if (resp.refresh_token) sess.refreshToken = resp.refresh_token;
    }
  } catch (e) {
    console.error('Failed to refresh Spotify token', e);
    // leave session as-is; caller will handle failures.
  }
  return sess;
}

// helper to call Spotify API on behalf of session
function spotifyGet(sess, path) {
  return new Promise(async (resolve, reject) => {
    await refreshAccessTokenIfNeeded(sess);
    if (!sess || !sess.accessToken) return reject(new Error('Missing spotify access token'));
    const options = { method: 'GET', headers: { 'Authorization': `Bearer ${sess.accessToken}` } };
    https.get(`https://api.spotify.com/v1${path}`, options, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// GET /api/spotify/top -> returns top artists, top tracks and aggregated genres
app.get('/api/spotify/top', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.spotifyId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const artists = await spotifyGet(sess, '/me/top/artists?limit=12&time_range=short_term');
    const tracks = await spotifyGet(sess, '/me/top/tracks?limit=12&time_range=short_term');

    // aggregate genres from artists
    const genreCounts = {};
    if (artists && Array.isArray(artists.items)) {
      for (const a of artists.items) {
        if (!a.genres) continue;
        for (const g of a.genres) {
          genreCounts[g] = (genreCounts[g] || 0) + 1;
        }
      }
    }
    const genres = Object.entries(genreCounts)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10)
      .map(([name,count])=>({ name, count }));

    res.json({
      artists: (artists && artists.items) || [],
      tracks: (tracks && tracks.items) || [],
      genres
    });
  } catch (err) {
    console.error('GET /api/spotify/top error', err);
    res.status(500).json({ error: 'Failed to fetch spotify top data' });
  }
});

app.listen(port, hostname, () => {
  console.log(`Listening at: http://${hostname}:${port}`);
});