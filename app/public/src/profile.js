async function apiGet(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw res;
  return res.json();
}
async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  if (!res.ok) throw res;
  return res.json();
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

function getElement(id) { return document.getElementById(id); }
function formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

async function loadProfile() {
  try {
    const p = await apiGet('/api/me');
    getElement('display_name').value = p.display_name || '';
    getElement('username').value = p.username || '';
    getElement('bio').value = p.bio || '';
    if (p.profile_pic_url) {
      const avatar = getElement('avatar');
      avatar.src = p.profile_pic_url;
      avatar.hidden = false;
    } else {
      const avatar = getElement('avatar');
      if (avatar) {
        avatar.hidden = true;
        avatar.removeAttribute('src');
      }
    }
  } catch (err) {
    if (err.status === 401) {
      // not authenticated — redirect to login
      window.location.href = '/login.html';
      return;
    }
    console.error('Failed to load profile', err);
    alert('Failed to load profile');
  }
}

async function saveProfile() {
  const body = {
    username: getElement('username').value,
    bio: getElement('bio').value
  };
  try {
    await apiPut('/api/me', body);
    window.location.href = '/index.html';
    alert('Profile saved');
    
  } catch (err) {
    console.error('Save failed', err);
    alert('Save failed');
  }
}

async function uploadAvatar() {
  const input = getElement('avatar_file');
  if (!input || !input.files || input.files.length === 0) {
    alert('Please choose an image file to upload.');
    return;
  }
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    try {
      const res = await apiPost('/api/me/avatar', { image: dataUrl });
      // update UI with returned profile_pic_url
      if (res && res.profile_pic_url) {
        const avatar = getElement('avatar');
        avatar.src = res.profile_pic_url;
        avatar.hidden = false;
      }
      alert('Upload successful');
    } catch (err) {
      console.error('Avatar upload failed', err);
      alert('Avatar upload failed');
    }
  };
  reader.readAsDataURL(file);
}

function logout() {
  // clear sid cookie client-side (simple)
  document.cookie = 'sid=; Max-Age=0; path=/';
  window.location.href = '/login.html';
}

async function loadPosts() {
  try {
    const posts = await apiGet('/api/posts');
    renderPosts(posts);
  } catch (err) {
    if (err.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    console.error('Failed to load posts', err);
    alert('Failed to load posts');
  }
}

function renderPosts(posts) {
  const container = getElement('posts_list');
  container.innerHTML = '';

  if (!posts || posts.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No posts yet.';
    container.appendChild(empty);
    return;
  }

  for (const post of posts) {
    const wrapper = document.createElement('article');
    wrapper.className = 'post';

    const body = document.createElement('p');
    body.textContent = post.content;
    wrapper.appendChild(body);

    const time = document.createElement('time');
    time.textContent = formatTimestamp(post.created_at);
    wrapper.appendChild(time);

    const commentsBlock = document.createElement('div');
    commentsBlock.className = 'comments';

    if (post.comments && post.comments.length > 0) {
      for (const comment of post.comments) {
        const commentEl = document.createElement('div');
        commentEl.className = 'comment';

        const commentContent = document.createElement('p');
        commentContent.textContent = comment.content;
        commentEl.appendChild(commentContent);

        const commentMeta = document.createElement('time');
        const author =
          comment.author_display_name ||
          comment.author_username ||
          'You';
        commentMeta.textContent = `${author} \u2014 ${formatTimestamp(comment.created_at)}`;
        commentEl.appendChild(commentMeta);

        commentsBlock.appendChild(commentEl);
      }
    }

    const form = document.createElement('div');
    form.className = 'comment-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a comment...';
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
        await loadPosts();
      } catch (err) {
        console.error('Failed to add comment', err);
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
}

async function createPost() {
  const textarea = getElement('post_content');
  const button = getElement('create_post');
  const content = textarea.value.trim();
  if (!content) {
    alert('Post content cannot be empty.');
    return;
  }
  button.disabled = true;
  try {
    await apiPost('/api/posts', { content });
    textarea.value = '';
    await loadPosts();
  } catch (err) {
    console.error('Failed to create post', err);
    alert('Failed to create post');
  } finally {
    button.disabled = false;
  }
}

async function loadSpotifyTop() {
  try {
    const data = await apiGet('/api/spotify/top');

    // create container if not present
    let container = document.getElementById('spotify_top');
    if (!container) {
      container = document.createElement('section');
      container.id = 'spotify_top';
      const h = document.createElement('h2');
      h.textContent = 'Your Top Spotify';
      container.appendChild(h);
      document.getElementById('profile').insertAdjacentElement('afterend', container);
    } else {
      container.innerHTML = '<h2>Your Top Spotify</h2>';
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
        const img = a.images && a.images[0] ? a.images[0].url : null;
        li.textContent = name;
        if (img) {
          const i = document.createElement('img');
          i.src = img;
          i.alt = name;
          i.style.width = '48px';
          i.style.height = '48px';
          i.style.objectFit = 'cover';
          i.style.marginRight = '8px';
          li.prepend(i);
        }
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
        const title = t.name || 'Unknown';
        const artists = (t.artists || []).map(a => a.name).join(', ');
        li.textContent = `${title} — ${artists}`;
        ul.appendChild(li);
      }
      twrap.appendChild(ul);
    } else {
      twrap.appendChild(Object.assign(document.createElement('p'), { textContent: 'No tracks available.' }));
    }
    container.appendChild(twrap);
  } catch (err) {
    console.error('Failed to load Spotify top', err);
    // ignore silently; user may be unauthenticated
  }
}

getElement('save').addEventListener('click', saveProfile);
getElement('logout').addEventListener('click', logout);
getElement('create_post').addEventListener('click', (event) => {
  event.preventDefault();
  createPost();
});

const uploadBtn = getElement('upload_avatar');
if (uploadBtn) uploadBtn.addEventListener('click', uploadAvatar);

loadProfile();
loadPosts();
loadSpotifyTop();
