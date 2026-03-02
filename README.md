# ERP Dashboard – Notion Burndown

Web frontend that acts as an ERP dashboard, pulling data from three Notion databases and showing burndown charts following the **Workstream → Epic → Deliverable → Task** hierarchy. Points exist only at the task level; deliverable, epic, and workstream burndowns are the sum of their child tasks.

## Setup

1. **Notion integration**
   - Create an [internal integration](https://www.notion.so/my-integrations) and copy the secret.
   - Share the three databases (Roadmap Progress Log, Neuron Workstreams, and the third DB) with the integration (••• → Add connections).

2. **Environment**
   - Copy `.env.example` to `.env`.
   - Set `NOTION_SECRET` and the three database IDs. The database ID is the 32-character string in the Notion URL (before `?`).
   - Set `NOTION_WORKSTREAMS_DB_ID` to whichever of the two extra databases is Neuron Workstreams (the one that has "Date started" and "Date expected to complete" per task).

3. **Install and run**
   ```bash
   cd erp-dashboard
   npm install
   cd client && npm install && cd ..
   npm run dev
   ```
   - API: http://localhost:3001  
   - Frontend: http://localhost:5173 (proxies `/api` to the backend)

## Features

- **Hierarchy**: Tree view of Workstream → Epic → Deliverable → Task from the Roadmap Progress Log.
- **Burndown**: Per-task and rolled-up (deliverable/epic/workstream) burndown charts. Ideal line from total points to zero by expected end date; actual line from Current Points over time.
- **Rebaseline**: When "Date started" or "Date expected to complete" changes (from Neuron Workstreams), the app shows a "Date changed" badge and optionally logs it in localStorage.

## API

- `GET /api/roadmap` – Merged roadmap + workstreams + hierarchy (for the dashboard).
- `GET /api/databases/roadmap` – Raw Roadmap Progress Log rows.
- `GET /api/databases/workstreams` – Raw Neuron Workstreams rows.
- `GET /api/databases/third` – Raw third database rows.
