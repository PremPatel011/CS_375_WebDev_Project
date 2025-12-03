async function apiGet(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw res;
  return res.json();
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

function formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

async function getCurrentUser() {
  try {
    const me = await apiGet('/api/me');
    return me; // { id, spotify_id, username, display_name, ... }
  } catch (err) {
    // not authenticated or failed -> treat as anonymous
    return null;
  }
}

function extractTrackTitle(t) {
    if (!t) return 'Unknown';
    return t.name ||
           t.title ||
           t.track_name ||
           t.trackTitle ||
           t.songName ||
           (t.track && (t.track.name || t.track.title)) ||
           t.title_text ||
           (typeof t === 'string' ? t : null) ||
           'Unknown';
}

function extractTrackArtists(t) {
    if (!t) return '';
    // artists as array of objects or strings
    if (Array.isArray(t.artists) && t.artists.length) {
        return t.artists.map(a => {
        if (!a) return '';
        if (typeof a === 'string') return a;
        return a.name || a.artist_name || a.title || '';
        }).filter(Boolean).join(', ');
    }
    // fallback arrays/names
    if (Array.isArray(t.artists_names) && t.artists_names.length) return t.artists_names.join(', ');
    if (Array.isArray(t.artist_names) && t.artist_names.length) return t.artist_names.join(', ');
    // single artist fields
    return t.artist || t.artist_name || t.artistName || '';
}
  
async function renderSpotifyTopForUser(userId) {
  try {
    // if the visitor is the profile owner, fetch the live Spotify top (same source as Profile page)
    const me = await getCurrentUser();
    let data;
    if (me && String(me.id) === String(userId)) {
      // live Spotify top for self (same shape as /api/spotify/top returns in server)
      data = await apiGet('/api/spotify/top');
      // guard fields (profile endpoint returns { artists, tracks, genres })
      data.artists = data.artists || [];
      data.tracks = data.tracks || [];
      data.genres = data.genres || [];
    } else {
      // public aggregated data (DB-derived)
      data = await apiGet(`/api/users/${encodeURIComponent(userId)}/spotify-top`);
      data.artists = data.artists || [];
      data.tracks = data.tracks || [];
      data.genres = data.genres || [];
    }

    // create container if not present (user.html already has #spotify_top)
    let container = document.getElementById('spotify_top');
    if (!container) {
      container = document.createElement('section');
      container.id = 'spotify_top';
      const h = document.createElement('h2');
      h.textContent = "User's Top Spotify";
      container.appendChild(h);
      document.getElementById('profile').insertAdjacentElement('afterend', container);
    } else {
      container.innerHTML = `<h2>User's Top Spotify</h2>`;
    }

    // Genres
    const gwrap = document.createElement('div');
    gwrap.innerHTML = '<h3>Top Genres</h3>';
    if (data.genres && data.genres.length) {
      const ul = document.createElement('ul');
      for (const g of data.genres) {
        const li = document.createElement('li');
        li.textContent = `${g.name} (${g.count})`;
        ul.appendChild(li);
      }
      gwrap.appendChild(ul);
    } else {
      gwrap.appendChild(Object.assign(document.createElement('p'), { textContent: 'No genres available.' }));
    }
    container.appendChild(gwrap);

    // Artists
    const awrap = document.createElement('div');
    awrap.innerHTML = '<h3>Top Artists</h3>';
    if (data.artists && data.artists.length) {
      const ul = document.createElement('ul');
      for (const a of data.artists) {
        const li = document.createElement('li');
        const name = a.name || 'Unknown';
        const img = a.images && a.images[0] ? a.images[0].url : (a.image || null);
        if (img) {
          const i = document.createElement('img');
          i.src = img;
          i.alt = name;
          i.style.width = '48px';
          i.style.height = '48px';
          i.style.objectFit = 'cover';
          i.style.marginRight = '8px';
          li.appendChild(i);
        }
        li.appendChild(document.createTextNode(name));
        ul.appendChild(li);
      }
      awrap.appendChild(ul);
    } else {
      awrap.appendChild(Object.assign(document.createElement('p'), { textContent: 'No artists available.' }));
    }
    container.appendChild(awrap);

    // Tracks
    const twrap = document.createElement('div');
    twrap.innerHTML = '<h3>Top Tracks</h3>';
    if (data.tracks && data.tracks.length) {
        const ul = document.createElement('ul');
        for (const t of data.tracks) {
        const li = document.createElement('li');
        const title = extractTrackTitle(t);
        const artists = extractTrackArtists(t);
        li.textContent = artists ? `${title} — ${artists}` : title;
        ul.appendChild(li);
        }
        twrap.appendChild(ul);
    } else {
      twrap.appendChild(Object.assign(document.createElement('p'), { textContent: 'No tracks available.' }));
    }
    container.appendChild(twrap);
  } catch (err) {
    console.error('Failed to load public spotify top', err);
    const container = document.getElementById('spotify_top');
    if (container) container.insertAdjacentElement('beforeend', Object.assign(document.createElement('p'), { textContent: 'Failed to load Spotify data.' }));
  }
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  if (!res.ok) throw res;
  return res.json();
}

// fetch and render public posts for this user (read-only)
async function loadUserPosts(userId) {
  try {
    const posts = await apiGet(`/api/users/${encodeURIComponent(userId)}/posts`);
    const container = document.getElementById('posts_list');
    container.innerHTML = '';

    if (!posts || posts.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No posts yet.';
      p.style.color = 'var(--muted)';
      container.appendChild(p);
      return;
    }

    for (const post of posts) {
      const wrapper = document.createElement('article');
      wrapper.className = 'post';

      const time = document.createElement('time');
      time.className = 'post-timestamp';
      time.textContent = formatTimestamp(post.created_at);
      wrapper.appendChild(time);

      const body = document.createElement('div');
      body.className = 'post-content';
      body.textContent = post.content;
      wrapper.appendChild(body);

      const commentsBlock = document.createElement('div');
      commentsBlock.className = 'comments';

      if (post.comments && post.comments.length > 0) {
        for (const comment of post.comments) {
          const commentEl = document.createElement('div');
          commentEl.className = 'comment';

          const commentContent = document.createElement('p');
          commentContent.style.margin = '0';
          commentContent.textContent = comment.content;
          commentEl.appendChild(commentContent);

          const commentMeta = document.createElement('span');
          commentMeta.className = 'comment-meta';
          const author =
            comment.author_display_name ||
            comment.author_username ||
            'User';
          commentMeta.textContent = `${author} \u2014 ${formatTimestamp(comment.created_at)}`;
          commentEl.appendChild(commentMeta);

          commentsBlock.appendChild(commentEl);
        }
      }

      // Add comment form so visitors can submit comments (requires auth)
      const form = document.createElement('div');
      form.className = 'comment-form';
      form.style.display = 'flex';
      form.style.gap = '0.5rem';
      form.style.marginTop = '0.75rem';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Add a comment...';
      input.style.flex = '1';
      form.appendChild(input);

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Comment';
      button.addEventListener('click', async () => {
        const content = input.value.trim();
        if (!content) return;
        button.disabled = true;
        try {
          await apiPost(`/api/posts/${post.id}/comments`, { content });
          input.value = '';
          // reload comments for this page
          await loadUserPosts(userId);
        } catch (err) {
          console.error('Failed to add comment', err);
          // if unauthenticated, redirect to login
          if (err.status === 401) {
            window.location.href = '/login.html';
            return;
          }
          alert('Failed to add comment');
        } finally {
          button.disabled = false;
        }
      });
      form.appendChild(button);

      commentsBlock.appendChild(form);


      wrapper.appendChild(commentsBlock);
      container.appendChild(wrapper);
    }
  } catch (err) {
    console.error('Failed to load user posts', err);
    const container = document.getElementById('posts_list');
    if (container) container.innerText = 'Failed to load posts';
  }
}

async function loadPublicProfile() {
  const id = qs('id');
  if (!id) {
    const profileEl = document.getElementById('profile');
    if (profileEl) profileEl.innerText = 'Missing user id';
    return;
  }

  try {
    const user = await apiGet(`/api/users/${id}`);

    // Use IDs used by Profile.html (display_name, username, bio, avatar)
    const dn = document.getElementById('display_name');
    const un = document.getElementById('username');
    const bio = document.getElementById('bio');
    const avatar = document.getElementById('avatar');

    if (dn) dn.value = user.display_name || '';
    if (un) un.value = user.username || '';
    if (bio) {
      // bio is readonly textarea in user.html
      bio.value = user.bio || '';
    }
    if (avatar) {
      if (user.profile_pic_url) {
        avatar.src = user.profile_pic_url;
        avatar.hidden = false;
      } else {
        avatar.hidden = true;
        avatar.removeAttribute('src');
      }
    }

    const visit = document.getElementById('visit_garden');
    if (visit) visit.href = `/index.html?viewUser=${encodeURIComponent(id)}`;

    // load public spotify top for this user
    await renderSpotifyTopForUser(id);

     // load this user's public posts (read-only)
    await loadUserPosts(id);

  } catch (err) {
    console.error('Failed to load public profile', err);
    const profileEl = document.getElementById('profile');
    if (profileEl) profileEl.innerText = 'Failed to load profile';
  }
}

loadPublicProfile();
