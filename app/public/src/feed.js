
async function apiGet(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
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

let currentOffset = 0;
const LIMIT = 15;

async function loadFeed(offset = 0, append = false) {
    try {
        const posts = await apiGet(`/api/feed?limit=${LIMIT}&offset=${offset}`);
        renderFeed(posts, append);

        const loadMoreBtn = getElement('load_more');
        if (posts.length < LIMIT) {
            loadMoreBtn.style.display = 'none';
        } else {
            loadMoreBtn.style.display = 'block';
        }
    } catch (err) {
        if (err.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        console.error('Failed to load feed', err);
        alert('Failed to load feed');
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
        // Reload feed from top
        currentOffset = 0;
        await loadFeed(0, false);
    } catch (err) {
        console.error('Failed to create post', err);
        alert('Failed to create post');
    } finally {
        button.disabled = false;
    }
}

function renderFeed(posts, append) {
    const container = getElement('posts_list');

    if (!append) {
        container.innerHTML = '';
    }

    if ((!posts || posts.length === 0) && !append) {
        const empty = document.createElement('p');
        empty.textContent = 'No posts yet.';
        empty.style.textAlign = 'center';
        empty.style.color = 'var(--muted)';
        container.appendChild(empty);
        return;
    }

    for (const post of posts) {
        const wrapper = document.createElement('article');
        wrapper.className = 'post';

        // Header with avatar and name
        const header = document.createElement('div');
        header.className = 'post-header';

        if (post.author && post.author.avatar_url) {
            const avatar = document.createElement('img');
            avatar.src = post.author.avatar_url;
            avatar.className = 'post-avatar';
            header.appendChild(avatar);
        } else {
            // Placeholder or no avatar
            const placeholder = document.createElement('div');
            placeholder.className = 'post-avatar';
            placeholder.style.backgroundColor = '#e0e0e0';
            placeholder.style.display = 'flex';
            placeholder.style.alignItems = 'center';
            placeholder.style.justifyContent = 'center';
            placeholder.textContent = (post.author.username || '?')[0].toUpperCase();
            placeholder.style.color = '#666';
            placeholder.style.fontWeight = 'bold';
            header.appendChild(placeholder);
        }

        const authorInfo = document.createElement('div');
        authorInfo.className = 'post-author-info';

        const authorName = document.createElement('span');
        authorName.className = 'post-author-name';
        authorName.textContent = post.author.display_name || post.author.username || 'Unknown';
        authorInfo.appendChild(authorName);

        const time = document.createElement('time');
        time.className = 'post-timestamp';
        time.textContent = formatTimestamp(post.created_at);
        authorInfo.appendChild(time);

        header.appendChild(authorInfo);
        wrapper.appendChild(header);

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

        const form = document.createElement('div');
        form.className = 'comment-form';
        form.style.display = 'flex';
        form.style.gap = '0.5rem';
        form.style.marginTop = '1rem';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Add a comment...';
        input.style.flex = '1';
        form.appendChild(input);

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Comment';
        button.className = 'btn-primary'; // Use primary class
        button.style.padding = '0.5rem 1rem';
        button.style.fontSize = '0.9rem';

        button.addEventListener('click', async () => {
            const content = input.value.trim();
            if (!content) return;
            button.disabled = true;
            try {
                await apiPost(`/api/posts/${post.id}/comments`, { content });
                input.value = '';

                const newComment = {
                    content: content,
                    created_at: new Date().toISOString(),
                    author_username: 'You',
                    author_display_name: 'You'
                };

                const commentEl = document.createElement('div');
                commentEl.className = 'comment';
                const commentContent = document.createElement('p');
                commentContent.style.margin = '0';
                commentContent.textContent = newComment.content;
                commentEl.appendChild(commentContent);
                const commentMeta = document.createElement('span');
                commentMeta.className = 'comment-meta';
                commentMeta.textContent = `You \u2014 ${formatTimestamp(newComment.created_at)}`;
                commentEl.appendChild(commentMeta);

                // Insert before the form
                commentsBlock.insertBefore(commentEl, form);

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

getElement('load_more').addEventListener('click', () => {
    currentOffset += LIMIT;
    loadFeed(currentOffset, true);
});

getElement('create_post').addEventListener('click', (event) => {
    event.preventDefault();
    createPost();
});

// Initial load
loadFeed();
