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
    getElement('profile_pic_url').value = p.profile_pic_url || '';
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
    profile_pic_url: getElement('profile_pic_url').value,
    bio: getElement('bio').value
  };
  try {
    await apiPut('/api/me', body);
    window.location.href = '/garden.html';
    alert('Profile saved');
    
  } catch (err) {
    console.error('Save failed', err);
    alert('Save failed');
  }
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

getElement('save').addEventListener('click', saveProfile);
getElement('logout').addEventListener('click', logout);
getElement('create_post').addEventListener('click', (event) => {
  event.preventDefault();
  createPost();
});

loadProfile();
loadPosts();
