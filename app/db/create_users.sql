CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  spotify_id TEXT UNIQUE NOT NULL,        -- Spotify account id (stable)
  username TEXT,                          -- username (can be same as spotify_id or custom)
  display_name TEXT,                      -- display name from Spotify
  email TEXT,
  profile_pic_url TEXT,
  bio TEXT,
  tracks_last_fetched_at TIMESTAMPTZ,     -- Track when user's tracks were last fetched
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (user_a_id < user_b_id),
  UNIQUE (user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracks (
  id SERIAL PRIMARY KEY,
  spotify_track_id VARCHAR(255) UNIQUE NOT NULL,
  recco_track_id VARCHAR(255) UNIQUE NOT NULL,
  track_info JSONB NOT NULL,
  audio_features JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_tracks (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  spotify_track_id VARCHAR(255) REFERENCES tracks(spotify_track_id) ON DELETE CASCADE,
  rank INTEGER,
  added_at TIMESTAMPTZ DEFAULT now(),
  last_fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, spotify_track_id)
);

CREATE INDEX idx_tracks_spotify_id ON tracks(spotify_track_id);
CREATE INDEX idx_tracks_recco_id ON tracks(recco_track_id);
CREATE INDEX idx_track_info ON tracks USING GIN(track_info);
CREATE INDEX idx_audio_features ON tracks USING GIN(audio_features);
CREATE INDEX idx_user_tracks_user_id ON user_tracks(user_id);
