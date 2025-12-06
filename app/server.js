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

// Root route: send the garden (index) if authenticated, otherwise go to login
app.get('/', (req, res) => {
  const sess = req.session; // see `getSessionFromReq` in this file
  if (sess && sess.userId) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  return res.redirect('/login.html');
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
    res.redirect('/index.html');
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

// GET suggested users (random 5 users not already friends)
app.get('/api/users/suggested', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Find users who are NOT the current user AND NOT in a friendship with current user
    // We use a subquery to find all friend IDs
    const q = `
      SELECT id, username, display_name, profile_pic_url
      FROM users
      WHERE id != $1
      AND id NOT IN (
        SELECT user_b_id FROM friendships WHERE user_a_id = $1
        UNION
        SELECT user_a_id FROM friendships WHERE user_b_id = $1
      )
      ORDER BY RANDOM()
      LIMIT 5
    `;
    const result = await pool.query(q, [sess.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/users/suggested error', err);
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

// Public endpoint: return spotify-like top data for a given user id (read-only)
app.get('/api/users/:id/spotify-top', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid id' });

  try {
    // get spotify_id for the user
    const u = await pool.query('SELECT spotify_id FROM users WHERE id = $1', [userId]);
    if (u.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const spotifyId = u.rows[0].spotify_id;

    // fetch saved tracks for this spotifyId
    const q = `
      SELECT t.track_info
      FROM user_tracks ut
      JOIN tracks t ON ut.spotify_track_id = t.spotify_track_id
      WHERE ut.user_id = $1
      ORDER BY ut.rank ASC
      LIMIT 50
    `;
    const tracksRes = await pool.query(q, [spotifyId]);
    const tracks = tracksRes.rows.map(r => r.track_info || r.track_info);

    // build artists list and genre counts (best-effort from saved track_info)
    const artistMap = new Map();
    const genreCounts = {};
    for (const tr of tracks) {
      // track_info shape may vary—try multiple fallbacks
      const artistsList = (tr.artists && Array.isArray(tr.artists)) ? tr.artists : (tr.artists_names ? tr.artists_names : []);
      if (Array.isArray(artistsList)) {
        for (const a of artistsList) {
          const name = a.name || a;
          const key = name || 'Unknown';
          if (!artistMap.has(key)) artistMap.set(key, { name: key, image: (a && a.images && a.images[0] && a.images[0].url) || null, count: 0 });
          const entry = artistMap.get(key);
          entry.count = (entry.count || 0) + 1;
        }
      }
      // attempt to read genres (if present on track_info or artist objects)
      if (tr.genres && Array.isArray(tr.genres)) {
        for (const g of tr.genres) genreCounts[g] = (genreCounts[g] || 0) + 1;
      } else if (tr.artists && Array.isArray(tr.artists)) {
        for (const a of tr.artists) {
          if (a.genres && Array.isArray(a.genres)) {
            for (const g of a.genres) genreCounts[g] = (genreCounts[g] || 0) + 1;
          }
        }
      }
    }

    const artists = Array.from(artistMap.values())
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 12);

    const genres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    res.json({
      artists,
      tracks,
      genres
    });
  } catch (err) {
    console.error('GET /api/users/:id/spotify-top error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:id/posts', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const postsResult = await pool.query(
      `SELECT id, content, created_at
       FROM posts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const posts = postsResult.rows;
    if (posts.length === 0) return res.json([]);

    const postIds = posts.map(p => p.id);
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
      if (!commentsByPost.has(row.post_id)) commentsByPost.set(row.post_id, []);
      commentsByPost.get(row.post_id).push({
        id: row.id,
        content: row.content,
        created_at: row.created_at,
        author_username: row.author_username,
        author_display_name: row.author_display_name
      });
    }

    const withComments = posts.map(post => ({
      id: post.id,
      content: post.content,
      created_at: post.created_at,
      comments: commentsByPost.get(post.id) || []
    }));

    res.json(withComments);
  } catch (err) {
    console.error('GET /api/users/:id/posts error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a friendship link between two users
app.post('/api/friendships', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  const parseId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  };

  let userId = parseId(req.body && req.body.userId);
  let friendId = parseId(req.body && req.body.friendId);

  if (!userId) {
    userId = sess.userId
  };
  if (userId !== sess.userId) {
    return res.status(403).json({ error: 'Cannot create friendships for another user' });
  }

  const friendUsername = req.body && typeof req.body.friendUsername === 'string'
    ? req.body.friendUsername.trim()
    : null;
  const friendSpotifyId = req.body && typeof req.body.friendSpotifyId === 'string'
    ? req.body.friendSpotifyId.trim()
    : null;

  try {
    if (!friendId && (friendUsername || friendSpotifyId)) {
      const clauses = [];
      const values = [];
      let idx = 1;
      if (friendUsername) {
        clauses.push(`LOWER(username) = LOWER($${idx})`);
        values.push(friendUsername);
        idx++;
      }
      if (friendSpotifyId) {
        clauses.push(`spotify_id = $${idx}`);
        values.push(friendSpotifyId);
        idx++;
      }
      const lookupSql = `SELECT id FROM users WHERE ${clauses.join(' OR ')} LIMIT 1`;
      const userLookup = await pool.query(lookupSql, values);
      if (userLookup.rowCount === 0) {
        return res.status(404).json({ error: 'Friend user not found' });
      }
      friendId = userLookup.rows[0].id;
    }

    if (!friendId) {
      return res.status(400).json({ error: 'friendId or a friend identifier is required' });
    }

    if (friendId === userId) {
      return res.status(400).json({ error: 'Cannot friend yourself' });
    }

    const friendExists = await pool.query('SELECT id FROM users WHERE id = $1', [friendId]);
    if (friendExists.rowCount === 0) {
      return res.status(404).json({ error: 'Friend user not found' });
    }

    const [userA, userB] = userId < friendId ? [userId, friendId] : [friendId, userId];
    const insertSql = `
      INSERT INTO friendships (user_a_id, user_b_id, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_a_id, user_b_id) DO NOTHING
      RETURNING id, user_a_id, user_b_id, created_at
    `;
    const insertResult = await pool.query(insertSql, [userA, userB, userId]);

    if (insertResult.rowCount === 0) {
      return res.status(200).json({ status: 'exists', message: 'Friendship already recorded' });
    }

    const friendship = insertResult.rows[0];
    const responsePayload = {
      id: friendship.id,
      user_a_id: friendship.user_a_id,
      user_b_id: friendship.user_b_id,
      created_at: friendship.created_at
    };
    res.status(201).json(responsePayload);
  } catch (err) {
    console.error('POST /api/friendships error', err);
    res.status(500).json({ error: 'Failed to create friendship' });
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

// Get global feed (all posts from all users)
app.get('/api/feed', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.userId) return res.status(401).json({ error: 'Not authenticated' });

  const limit = parseInt(req.query.limit, 10) || 15;
  const offset = parseInt(req.query.offset, 10) || 0;

  try {
    const postsResult = await pool.query(
      `SELECT p.id, p.content, p.created_at, p.user_id,
              u.username AS author_username,
              u.display_name AS author_display_name,
              u.profile_pic_url AS author_avatar_url
       FROM posts p
       JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
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
      author: {
        id: post.user_id,
        username: post.author_username,
        display_name: post.author_display_name,
        avatar_url: post.author_avatar_url
      },
      comments: commentsByPost.get(post.id) || []
    }));

    res.json(withComments);
  } catch (err) {
    console.error('GET /api/feed error', err);
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
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

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

// GET /api/spotify/tracks -> returns last 50 saved tracks
app.get('/api/spotify/tracks', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.spotifyId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const tracks = await spotifyGet(sess, '/me/top/tracks?limit=50');

    res.json({
      tracks: (tracks && tracks.items) || []
    });
  } catch (err) {
    console.error('GET /api/spotify/top error', err);
    res.status(500).json({ error: 'Failed to fetch user spotify track data' });
  }
});

// GET /api/recco/tracks -> returns last 40 saved tracks, needed to get the reccobeats specific id
app.get('/api/recco/tracks', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.spotifyId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const spotifyData = await spotifyGet(sess, '/me/top/tracks?limit=50');
    const spotifyTracks = (spotifyData && spotifyData.items) || [];

    if (spotifyTracks.length === 0) {
      return res.json({ tracks: [] });
    }

    const trackIds = [...new Set(spotifyTracks.map(track => track.id))].slice(0, 40);

    const reccobeatsUrl = 'https://api.reccobeats.com/v1/track?' +
      trackIds.map(id => `ids=${id}`).join('&');

    const reccoResponse = await fetch(reccobeatsUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      redirect: 'follow'
    });

    if (!reccoResponse.ok) {
      const errorText = await reccoResponse.text();
      console.error('Reccobeats error response:', errorText);
      throw new Error(`Reccobeats API error: ${reccoResponse.status} - ${errorText}`);
    }

    const reccoData = await reccoResponse.json();

    res.json({
      tracks: reccoData.content || []
    });
  } catch (err) {
    console.error('GET /api/recco/tracks error:', err);
    res.status(500).json({ error: 'Failed to fetch reccobeats track data', details: err.message });
  }
});

app.get('/api/recco/tracks/audio-features/batch', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.spotifyId) return res.status(401).json({ error: 'Not authenticated' });

  const { ids } = req.query;

  if (!ids) {
    return res.status(400).json({ error: 'Track IDs are required' });
  }

  try {
    const trackIds = ids.split(',').filter(id => id.trim());

    if (trackIds.length === 0) {
      return res.status(400).json({ error: 'No valid track IDs provided' });
    }

    const audioFeaturesPromises = trackIds.map(async (id) => {
      try {
        const reccobeatsUrl = `https://api.reccobeats.com/v1/track/${id}/audio-features`;
        const response = await fetch(reccobeatsUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          },
          redirect: 'follow'
        });

        if (!response.ok) {
          console.warn(`Failed to fetch audio features for track ${id}: ${response.status}`);
          return null;
        }

        return await response.json();
      } catch (err) {
        console.error(`Error fetching audio features for track ${id}:`, err);
        return null;
      }
    });

    const audioFeaturesResults = await Promise.all(audioFeaturesPromises);
    const audioFeatures = audioFeaturesResults.filter(result => result !== null);

    res.json({
      audioFeatures,
      total: audioFeatures.length,
      requested: trackIds.length
    });
  } catch (err) {
    console.error('GET /api/recco/tracks/audio-features/batch error', err);
    res.status(500).json({ error: 'Failed to fetch batch audio features' });
  }
});

app.get('/api/user/tracks/needs-refresh', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.spotifyId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await pool.query(
      'SELECT tracks_last_fetched_at FROM users WHERE spotify_id = $1',
      [sess.spotifyId]
    );

    const lastFetch = result.rows[0]?.tracks_last_fetched_at;

    if (!lastFetch) {
      return res.json({ needsRefresh: true });
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const needsRefresh = new Date(lastFetch) < oneWeekAgo;

    res.json({ needsRefresh });
  } catch (err) {
    console.error('Error checking refresh status:', err);
    res.status(500).json({ error: 'Failed to check refresh status' });
  }
});

app.post('/api/user/tracks/save', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.spotifyId) return res.status(401).json({ error: 'Not authenticated' });

  const { tracks, audioFeatures } = req.body;

  try {
    await pool.query('BEGIN');

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const features = audioFeatures.find(f => f.id === track.id);

      let spotifyId = track.id;
      if (track.href && track.href.includes('spotify.com/track/')) {
        const parts = track.href.split('/track/');
        if (parts.length > 1) {
          spotifyId = parts[1].split('?')[0];
        }
      }

      const reccoId = track.id;

      await pool.query(
        `INSERT INTO tracks (spotify_track_id, recco_track_id, track_info, audio_features)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (spotify_track_id) 
         DO UPDATE SET 
           recco_track_id = $2,
           track_info = $3, 
           audio_features = $4`,
        [spotifyId, reccoId, JSON.stringify(track), JSON.stringify(features || {})]
      );

      await pool.query(
        `INSERT INTO user_tracks (user_id, spotify_track_id, rank)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, spotify_track_id)
         DO UPDATE SET rank = $3`,
        [sess.spotifyId, spotifyId, i + 1]
      );
    }

    await pool.query(
      'UPDATE users SET tracks_last_fetched_at = NOW() WHERE spotify_id = $1',
      [sess.spotifyId]
    );

    await pool.query('COMMIT');
    res.json({ success: true, tracksSaved: tracks.length });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error saving tracks:', err);
    res.status(500).json({ error: 'Failed to save tracks' });
  }
});

// Get tracks from database
app.get('/api/user/tracks/from-db', async (req, res) => {
  const sess = req.session;
  if (!sess || !sess.spotifyId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await pool.query(
      `SELECT t.track_info, t.audio_features, ut.rank
       FROM user_tracks ut
       JOIN tracks t ON ut.spotify_track_id = t.spotify_track_id
       WHERE ut.user_id = $1
       ORDER BY ut.rank ASC`,
      [sess.spotifyId]
    );

    res.json({
      tracks: result.rows.map(row => row.track_info),
      audioFeatures: result.rows.map(row => row.audio_features)
    });
  } catch (err) {
    console.error('Error fetching tracks from DB:', err);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

app.listen(port, hostname, () => {
  console.log(`Listening at: http://${hostname}:${port}`);
});
