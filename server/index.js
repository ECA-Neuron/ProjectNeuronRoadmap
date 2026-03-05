const path = require('path');
const fs = require('fs');

function loadEnvManually(envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key) process.env[key] = value;
      }
    }
  }
}

const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    loadEnvManually(envPath);
    console.log('Loaded .env from:', envPath);
    break;
  }
}
const express = require('express');
const cors = require('cors');
const { queryNotionDatabase, getMergedRoadmap, pushMeetingToNotion, pushPersonNotesToNotion } = require('./notion');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true }));
app.use(express.json());

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

const CACHE_TTL_MS = 60 * 1000;
let cache = { data: null, timestamp: 0, refreshing: false };

async function refreshCache() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  const start = Date.now();
  try {
    const data = await getMergedRoadmap();
    cache.data = data;
    cache.timestamp = Date.now();
    console.log(`Cache refreshed in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('Cache refresh error:', err.message);
  } finally {
    cache.refreshing = false;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, cached: !!cache.data, cacheAge: cache.data ? Date.now() - cache.timestamp : null });
});

app.get('/api/roadmap', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const cacheAge = Date.now() - cache.timestamp;

  if (cache.data && !forceRefresh && cacheAge < CACHE_TTL_MS) {
    return res.json(cache.data);
  }

  if (cache.data && cacheAge >= CACHE_TTL_MS) {
    res.json(cache.data);
    refreshCache();
    return;
  }

  try {
    const data = await getMergedRoadmap();
    cache.data = data;
    cache.timestamp = Date.now();
    res.json(data);
  } catch (err) {
    console.error('Roadmap API error:', err);
    if (cache.data) return res.json(cache.data);
    res.status(500).json({
      error: err.message || 'Failed to fetch roadmap',
      code: err.code,
    });
  }
});

app.get('/api/databases/roadmap', async (req, res) => {
  try {
    const rows = await queryNotionDatabase(process.env.NOTION_ROADMAP_DB_ID);
    res.json(rows);
  } catch (err) {
    console.error('Roadmap DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/databases/workstreams', async (req, res) => {
  try {
    const rows = await queryNotionDatabase(process.env.NOTION_WORKSTREAMS_DB_ID);
    res.json(rows);
  } catch (err) {
    console.error('Workstreams DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/databases/third', async (req, res) => {
  try {
    const rows = await queryNotionDatabase(process.env.NOTION_THIRD_DB_ID);
    res.json(rows);
  } catch (err) {
    console.error('Third DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/meeting/push', async (req, res) => {
  try {
    const { weekLabel, weekDate, people, openIssues, notes, actionItems } = req.body;
    if (!weekLabel || !weekDate) {
      return res.status(400).json({ error: 'weekLabel and weekDate are required' });
    }
    const result = await pushMeetingToNotion({ weekLabel, weekDate, people, openIssues, notes, actionItems });
    res.json({ success: true, url: result.url, id: result.id });
  } catch (err) {
    console.error('Meeting push error:', err);
    res.status(500).json({ error: err.message || 'Failed to push meeting to Notion' });
  }
});

app.post('/api/meeting/push-notes', async (req, res) => {
  try {
    const { pageId, personName, notes, actionItems } = req.body;
    if (!pageId || !personName) {
      return res.status(400).json({ error: 'pageId and personName are required' });
    }
    await pushPersonNotesToNotion({ pageId, personName, notes, actionItems });
    res.json({ success: true });
  } catch (err) {
    console.error('Person notes push error:', err);
    res.status(500).json({ error: err.message || 'Failed to push notes to Notion' });
  }
});

if (fs.existsSync(clientDist)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`ERP Dashboard API running at http://localhost:${PORT}`);
  if (process.env.NOTION_SECRET) {
    console.log('NOTION_SECRET is set — pre-warming cache...');
    refreshCache();
  } else {
    console.warn('WARNING: NOTION_SECRET is not set. Add it to .env in the erp-dashboard folder and restart.');
  }
});
