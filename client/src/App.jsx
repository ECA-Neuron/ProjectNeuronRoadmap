import React, { useState, useEffect, useCallback, useMemo } from 'react';
import HierarchyTree from './HierarchyTree';
import BurndownChart from './BurndownChart';
import TaskDetail from './TaskDetail';
import RecentUpdates from './RecentUpdates';
import OpenIssuesBanner from './OpenIssuesBanner';
import ProjectHome from './ProjectHome';
import OpenIssuesPage from './OpenIssuesPage';
import { buildTaskSeriesFromMerged, rollupBurndown, computeLateBlockers } from './burndown';
import DateChangeBanner from './DateChangeBanner';
import { detectAndPersistRebaselines, detectAllLevelDateChanges } from './rebaseline';

const API_BASE = '/api';

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('erp_theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('erp_theme', theme); } catch {}
  }, [theme]);
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return { theme, toggle };
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [taskSeries, setTaskSeries] = useState({});
  const [rebaselinedIds, setRebaselinedIds] = useState(new Set());
  const [dateChanges, setDateChanges] = useState([]);
  const [levelDates, setLevelDates] = useState({ deliverable: {}, epic: {}, workstream: {} });
  const [filterLevel, setFilterLevel] = useState('');
  const [filterWorkstream, setFilterWorkstream] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterDeliverable, setFilterDeliverable] = useState('');
  const [filterOpenIssues, setFilterOpenIssues] = useState(false);
  const [activePage, setActivePage] = useState('home');

  const fetchRoadmap = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    const MAX_RETRIES = 3;
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
        const url = forceRefresh ? `${API_BASE}/roadmap?refresh=true` : `${API_BASE}/roadmap`;
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || res.statusText || 'Failed to fetch');
        }
        const json = await res.json();
      setData(json);
      const rows = json.roadmapRows ?? [];
      setTaskSeries(buildTaskSeriesFromMerged(rows));
      setLevelDates({
        deliverable: json.deliverableDates ?? {},
        epic: json.epicDates ?? {},
        workstream: json.workstreamDates ?? {},
      });
      const changedIds = detectAndPersistRebaselines(rows);
      setRebaselinedIds(new Set(changedIds));
      const { allDateChanges } = detectAllLevelDateChanges(rows);
      setDateChanges(allDateChanges);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      setError(lastErr.message);
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRoadmap(); }, [fetchRoadmap]);

  const workstreamNames = useMemo(() => {
    return (data?.hierarchy ?? []).map(ws => ws.name);
  }, [data]);

  const deliverableNames = useMemo(() => {
    const names = new Set();
    for (const ws of (data?.hierarchy ?? [])) {
      for (const epic of (ws.epics ?? [])) {
        for (const del of (epic.deliverables ?? [])) {
          if (del.name && del.name !== 'Unknown') names.add(del.name);
        }
      }
    }
    return [...names].sort();
  }, [data]);

  const assigneeNames = useMemo(() => {
    const names = new Set();
    for (const row of (data?.roadmapRows ?? [])) {
      if (row.assignee && row.assignee !== 'Unassigned') names.add(row.assignee);
    }
    return [...names].sort();
  }, [data]);

  const lateBlockers = useMemo(() => {
    if (!data) return [];
    const allTasks = (data.roadmapRows ?? []);
    return computeLateBlockers(allTasks, taskSeries);
  }, [data, taskSeries]);

  const issueTaskIds = useMemo(() => {
    if (!filterOpenIssues) return null;
    const openIssues = (data?.openIssues ?? []).filter(
      i => (i.status ?? '').toLowerCase() !== 'closed' && (i.status ?? '').toLowerCase() !== 'resolved'
    );
    return new Set(openIssues.map(i => i.relatedTaskId).filter(Boolean));
  }, [data, filterOpenIssues]);

  const filteredHierarchy = useMemo(() => {
    let hierarchy = data?.hierarchy ?? [];

    if (filterAssignee) {
      hierarchy = hierarchy.map(ws => ({
        ...ws,
        epics: ws.epics?.map(epic => ({
          ...epic,
          deliverables: epic.deliverables?.map(del => ({
            ...del,
            tasks: del.tasks?.filter(t => t.assignee === filterAssignee) ?? [],
          })).filter(del => del.tasks.length > 0) ?? [],
          tasks: epic.tasks?.filter(t => t.assignee === filterAssignee) ?? [],
        })).filter(epic => epic.deliverables.length > 0) ?? [],
        tasks: ws.tasks?.filter(t => t.assignee === filterAssignee) ?? [],
      })).filter(ws => ws.epics.length > 0);
    }

    if (filterDeliverable) {
      hierarchy = hierarchy.map(ws => ({
        ...ws,
        epics: ws.epics?.map(epic => ({
          ...epic,
          deliverables: epic.deliverables?.filter(del => del.name === filterDeliverable) ?? [],
          tasks: epic.tasks?.filter(t => t.Deliverable === filterDeliverable) ?? [],
        })).filter(epic => epic.deliverables.length > 0) ?? [],
        tasks: ws.tasks?.filter(t => t.Deliverable === filterDeliverable) ?? [],
      })).filter(ws => ws.epics.length > 0);
    }

    if (issueTaskIds) {
      hierarchy = hierarchy.map(ws => ({
        ...ws,
        epics: ws.epics?.map(epic => ({
          ...epic,
          deliverables: epic.deliverables?.map(del => ({
            ...del,
            tasks: del.tasks?.filter(t => issueTaskIds.has(t.taskId)) ?? [],
          })).filter(del => del.tasks.length > 0) ?? [],
          tasks: epic.tasks?.filter(t => issueTaskIds.has(t.taskId)) ?? [],
        })).filter(epic => epic.deliverables.length > 0) ?? [],
        tasks: ws.tasks?.filter(t => issueTaskIds.has(t.taskId)) ?? [],
      })).filter(ws => ws.epics.length > 0);
    }

    return hierarchy;
  }, [data, filterAssignee, filterDeliverable, issueTaskIds]);

  const navigateToTask = useCallback((task) => {
    const key = `${task.Workstream}|${task.Epic}|${task.Deliverable}|${task.taskName}`;
    setSelected({ type: 'task', key, name: task.taskName, tasks: [task] });
  }, []);

  const currentSeries = (() => {
    if (!selected) return null;
    if (selected.type === 'task') return taskSeries[selected.key] ?? null;
    const dateOverride =
      selected.type === 'deliverable' ? levelDates.deliverable[selected.name] :
      selected.type === 'epic' ? levelDates.epic[selected.name] :
      selected.type === 'workstream' ? levelDates.workstream[selected.name] :
      null;
    return rollupBurndown(taskSeries, { tasks: selected.tasks ?? [] }, dateOverride);
  })();

  const selectedTask = selected?.type === 'task' ? (selected.tasks?.[0] ?? null) : null;
  const chartTitle = selected
    ? `${selected.type.charAt(0).toUpperCase() + selected.type.slice(1)}: ${selected.name}`
    : 'Select a node for burndown';

  if (loading && !data) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Neuron ERP Dashboard</h1>
          <div className="header-actions">
            <button type="button" className="btn-theme" onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? '\u2600' : '\u263E'}
            </button>
          </div>
        </header>
        <div className="app-loading">
          <div style={{ width: '100%', maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="skeleton-pulse skeleton-row" style={{ width: '60%' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div className="skeleton-pulse skeleton-card" />
              <div className="skeleton-pulse skeleton-card" />
              <div className="skeleton-pulse skeleton-card" />
            </div>
            <div className="skeleton-pulse skeleton-row" style={{ width: '80%' }} />
            <div className="skeleton-pulse skeleton-card" style={{ height: 200 }} />
          </div>
          <span>Loading roadmap from Notion&hellip;</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
        <header className="app-header">
          <h1>Neuron ERP Dashboard</h1>
          <div className="header-actions">
            <button type="button" className="btn-refresh" onClick={() => fetchRoadmap(true)} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button type="button" className="btn-theme" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '\u2600' : '\u263E'}
          </button>
        </div>
      </header>
      {error && <div className="app-error">{error}</div>}
      <OpenIssuesBanner issues={data?.openIssues ?? []} />
      <DateChangeBanner dateChanges={dateChanges} />
      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="nav-tab-group">
              <button
                type="button"
                className={`nav-tab ${!selected && activePage === 'home' ? 'active' : ''}`}
                onClick={() => { setSelected(null); setActivePage('home'); }}
              >
                <span className="nav-tab-icon">&#8962;</span>
                <span className="nav-tab-label">Overview</span>
              </button>
              <div className="nav-tab-divider" />
              <button
                type="button"
                className={`nav-tab nav-tab-issues ${!selected && activePage === 'issues' ? 'active' : ''}`}
                onClick={() => { setSelected(null); setActivePage('issues'); }}
              >
                <span className="nav-tab-icon">&#9888;</span>
                <span className="nav-tab-label">Issues</span>
              </button>
            </div>
          </div>
          <div className="sidebar-filters">
            <select className="filter-select" value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
              <option value="">All levels</option>
              <option value="deliverable">Deliverables</option>
              <option value="task">Tasks</option>
            </select>
            <select className="filter-select" value={filterWorkstream} onChange={e => setFilterWorkstream(e.target.value)}>
              <option value="">All workstreams</option>
              {workstreamNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <select className="filter-select" value={filterDeliverable} onChange={e => setFilterDeliverable(e.target.value)}>
              <option value="">All deliverables</option>
              {deliverableNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="sidebar-filters">
            <select className="filter-select" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
              <option value="">All assignees</option>
              {assigneeNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <label className="filter-toggle">
              <input type="checkbox" checked={filterOpenIssues} onChange={e => setFilterOpenIssues(e.target.checked)} />
              <span className="filter-toggle-label">Open Issues</span>
            </label>
          </div>
          <HierarchyTree
            hierarchy={filteredHierarchy}
            selected={selected}
            onSelect={setSelected}
            rebaselinedTaskKeys={rebaselinedIds}
            filterLevel={filterLevel}
            filterWorkstream={filterWorkstream}
          />
        </aside>
        <main className="main">
          {!selected && data && activePage === 'issues' && (
            <OpenIssuesPage issues={data?.openIssues ?? []} />
          )}
          {!selected && data && activePage === 'home' && (
            <ProjectHome
              data={data}
              taskSeries={taskSeries}
              onNavigateToTask={navigateToTask}
              onNavigateToIssues={() => { setSelected(null); setActivePage('issues'); }}
              onSelectNode={(node) => {
                const ws = (data.hierarchy ?? []).find(w => w.name === node.name);
                if (ws) {
                  const allTasks = [];
                  for (const epic of (ws.epics ?? [])) {
                    for (const del of (epic.deliverables ?? [])) {
                      allTasks.push(...(del.tasks ?? []));
                    }
                  }
                  setSelected({ type: 'workstream', name: ws.name, tasks: allTasks, url: ws.url });
                }
              }}
            />
          )}
          {selected && (
            <>
              {selected.url && (
                <div className="notion-open-bar">
                  <a href={selected.url} target="_blank" rel="noopener noreferrer" className="notion-open-btn">
                    Open in Notion &#8599;
                  </a>
                </div>
              )}
              <BurndownChart
                series={currentSeries}
                title={chartTitle}
                level={selected?.type ?? 'node'}
                assignee={selectedTask?.assignee}
                blockingItems={
                  selected?.type === 'task' && selectedTask
                    ? lateBlockers.filter(lb => lb.blockerTaskId === selectedTask.taskId)
                    : undefined
                }
              />
              {selected.type === 'task' && selectedTask && (
                <TaskDetail task={selectedTask} openIssues={data?.openIssues ?? []} lateBlockers={lateBlockers} />
              )}
              {selected.type !== 'task' && (
                <RecentUpdates
                  tasks={selected.tasks ?? []}
                  level={selected.type}
                  onNavigateToTask={navigateToTask}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
