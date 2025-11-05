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

function getElement(id) { return document.getElementById(id); }

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

getElement('save').addEventListener('click', saveProfile);
getElement('logout').addEventListener('click', logout);

loadProfile();