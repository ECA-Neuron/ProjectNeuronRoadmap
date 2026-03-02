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
const { queryNotionDatabase, getMergedRoadmap } = require('./notion');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true }));
app.use(express.json());

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/roadmap', async (req, res) => {
  try {
    const data = await getMergedRoadmap();
    res.json(data);
  } catch (err) {
    console.error('Roadmap API error:', err);
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

if (fs.existsSync(clientDist)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`ERP Dashboard API running at http://localhost:${PORT}`);
  if (process.env.NOTION_SECRET) {
    console.log('NOTION_SECRET is set');
  } else {
    console.warn('WARNING: NOTION_SECRET is not set. Add it to .env in the erp-dashboard folder and restart.');
  }
});
