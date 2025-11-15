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

async function getUserTrackFeatures() {
  try {
    const refreshCheck = await apiGet('/api/user/tracks/needs-refresh');
    
    if (!refreshCheck.needsRefresh) {
      return await apiGet('/api/user/tracks/from-db');
    }
    
    const reccoData = await apiGet('/api/recco/tracks');
    
    if (!reccoData.tracks || reccoData.tracks.length === 0) {
      return { tracks: [], audioFeatures: [] };
    }
    
    const trackIds = reccoData.tracks.map(track => track.id).join(',');
    const audioFeaturesData = await apiGet(`/api/recco/tracks/audio-features/batch?ids=${trackIds}`);
    
    await apiPost('/api/user/tracks/save', {
      tracks: reccoData.tracks,
      audioFeatures: audioFeaturesData.audioFeatures
    });
    
    return {
      tracks: reccoData.tracks,
      audioFeatures: audioFeaturesData.audioFeatures
    };
    
  } catch (error) {
    console.error('Error fetching user track features:', error);
    throw error;
  }
}

async function getUserAudioFeatures() {
  try {
    const data = await apiGet('/api/user/tracks/from-db');
    
    const audioFeatures = data.audioFeatures.map(features => ({
      acousticness: features.acousticness,
      danceability: features.danceability,
      energy: features.energy,
      instrumentalness: features.instrumentalness,
      liveness: features.liveness,
      loudness: features.loudness,
      tempo: features.tempo,
      valence: features.valence
    }));
    
    return audioFeatures;
  } catch (error) {
    console.error('Error fetching audio features:', error);
    throw error;
  }
}

async function getAverageAudioFeatures() {
  try {
    const data = await apiGet('/api/user/tracks/from-db');
    const features = data.audioFeatures;
    
    if (features.length === 0) {
      return null;
    }
    
    const avg = {
      acousticness: 0,
      danceability: 0,
      energy: 0,
      instrumentalness: 0,
      liveness: 0,
      loudness: 0,
      tempo: 0,
      valence: 0
    };
    
    features.forEach(f => {
      avg.acousticness += f.acousticness || 0;
      avg.danceability += f.danceability || 0;
      avg.energy += f.energy || 0;
      avg.instrumentalness += f.instrumentalness || 0;
      avg.liveness += f.liveness || 0;
      avg.loudness += f.loudness || 0;
      avg.tempo += f.tempo || 0;
      avg.valence += f.valence || 0;
    });
    
    const count = features.length;
    Object.keys(avg).forEach(key => {
      avg[key] = avg[key] / count;
    });
    
    return avg;
  } catch (error) {
    console.error('Error calculating average audio features:', error);
    throw error;
  }
}

async function initializeUserTracks() {
  try {
    await getUserTrackFeatures();
    
    const audio = await getAverageAudioFeatures();
    
    // console.log('Average Audio Features:', audio);
    
    return audio;
  } catch (error) {
    console.error('Error initializing tracks:', error);
  }
}