import React, { useState, useMemo, useEffect, useRef } from 'react';
import { isSeriesOffTrack } from './burndown';

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPct(v) {
  return `${Math.round((v ?? 0) * 100)}%`;
}

function getWeekBounds() {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return {
    monday: monday.toISOString().slice(0, 10),
    friday: friday.toISOString().slice(0, 10),
  };
}

function storageKey(wk, person) {
  return person ? `meeting_notes_${wk}_${person}` : `meeting_notes_${wk}`;
}

function loadNotes(wk, person) {
  try {
    const raw = localStorage.getItem(storageKey(wk, person));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { text: '', items: [] };
}

function saveNotes(wk, person, notes) {
  try { localStorage.setItem(storageKey(wk, person), JSON.stringify(notes)); } catch {}
}

function loadPageId(wk) {
  try { return localStorage.getItem(`meeting_pageId_${wk}`) || null; } catch { return null; }
}

function savePageId(wk, id) {
  try { localStorage.setItem(`meeting_pageId_${wk}`, id); } catch {}
}

function extractFirstNames(name) {
  return name.split(/[,&+]/)
    .map(part => part.replace(/[@#]/g, '').trim().split(/\s+/)[0])
    .filter(w => w && w.length >= 2);
}

function PersonFilter({ allNames, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleName = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  const selectAll = () => onChange(new Set());

  const label = selected.size === 0
    ? 'All People'
    : selected.size === 1
      ? [...selected][0]
      : [...selected].join(', ');

  return (
    <div className="meeting-person-filter" ref={ref}>
      <button type="button" className="meeting-filter-btn" onClick={() => setOpen(o => !o)}>
        {label} <span className="meeting-filter-caret">{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && (
        <div className="meeting-filter-dropdown">
          <button
            type="button"
            className={`meeting-filter-option ${selected.size === 0 ? 'active' : ''}`}
            onClick={selectAll}
          >
            All People
          </button>
          <div className="meeting-filter-divider" />
          {allNames.map(name => (
            <label key={name} className="meeting-filter-option meeting-filter-check-label">
              <input
                type="checkbox"
                checked={selected.has(name)}
                onChange={() => toggleName(name)}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function StaleTasksDropdown({ staleCount, totalAssigned, staleTasks, onNavigateToTask }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="meeting-stale-dropdown">
      <button type="button" className="meeting-stale-toggle" onClick={() => setOpen(o => !o)}>
        <span className="meeting-person-stale-text">
          {staleCount} of {totalAssigned} assigned tasks not updated this period
        </span>
        <span className="meeting-stale-caret">{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && staleTasks.length > 0 && (
        <ul className="meeting-stale-list">
          {staleTasks.map(t => (
            <li key={t.taskId} className="meeting-stale-item">
              <button type="button" className="meeting-task-link" onClick={() => onNavigateToTask?.(t.task)}>
                {t.taskName}
              </button>
              {t.dateStarted && (
                <span className="meeting-stale-date">Start: {formatDate(t.dateStarted)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function WeeklyMeeting({ data, taskSeries, onNavigateToTask }) {
  const rows = data?.roadmapRows ?? [];
  const openIssues = (data?.openIssues ?? []).filter(
    i => (i.status ?? '').toLowerCase() !== 'closed' && (i.status ?? '').toLowerCase() !== 'resolved'
  );

  const { monday, friday } = getWeekBounds();
  const today = new Date().toISOString().slice(0, 10);

  const [selectedPeople, setSelectedPeople] = useState(new Set());
  const [timeRange, setTimeRange] = useState('week');

  const rangeBounds = useMemo(() => {
    const now = new Date();
    if (timeRange === 'day') {
      return { start: today, end: today, label: 'Today', subtitle: formatDate(today) };
    }
    if (timeRange === 'week') {
      return { start: monday, end: friday, label: 'This Week', subtitle: `${formatDate(monday)} \u2013 ${formatDate(friday)}` };
    }
    if (timeRange === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const monthName = now.toLocaleDateString(undefined, { month: 'long' });
      return { start: first, end: last, label: monthName, subtitle: `${formatDate(first)} \u2013 ${formatDate(last)}` };
    }
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    const qStart = new Date(now.getFullYear(), qMonth, 1).toISOString().slice(0, 10);
    const qEnd = new Date(now.getFullYear(), qMonth + 3, 0).toISOString().slice(0, 10);
    const qNum = Math.floor(qMonth / 3) + 1;
    return { start: qStart, end: qEnd, label: `Q${qNum}`, subtitle: `${formatDate(qStart)} \u2013 ${formatDate(qEnd)}` };
  }, [timeRange, today, monday, friday]);

  // ── All updates in range ──

  const weekUpdates = useMemo(() => {
    const updates = [];
    for (const task of rows) {
      for (const pr of (task.progressRows ?? [])) {
        if (pr.date >= rangeBounds.start && pr.date <= rangeBounds.end) {
          const person = pr.userName || task.assignee || 'Unknown';
          updates.push({
            taskId: task.taskId,
            taskName: task.taskName,
            assignee: task.assignee ?? 'Unknown',
            person,
            workstream: task.Workstream ?? '',
            deliverable: task.Deliverable ?? '',
            date: pr.date,
            prevPct: pr.prevPercentComplete ?? 0,
            pct: pr.percentComplete ?? 0,
            deltaPts: ((pr.percentComplete ?? 0) - (pr.prevPercentComplete ?? 0)) * (task.totalPoints ?? 0),
            comment: pr.comment ?? '',
            userName: pr.userName || 'Unknown',
            task,
          });
        }
      }
    }
    updates.sort((a, b) => b.date.localeCompare(a.date));
    return updates;
  }, [rows, rangeBounds.start, rangeBounds.end]);

  // ── All unique first names for the filter ──

  const allFullNames = useMemo(() => {
    const names = new Set();
    for (const u of weekUpdates) names.add(u.person);
    for (const task of rows) {
      const name = task.assignee ?? 'Unknown';
      if (name) names.add(name);
    }
    return [...names];
  }, [weekUpdates, rows]);

  const firstNameOptions = useMemo(() => {
    const seen = new Map();
    for (const full of allFullNames) {
      for (const raw of extractFirstNames(full)) {
        const key = raw.toLowerCase();
        if (!seen.has(key)) seen.set(key, raw.charAt(0).toUpperCase() + raw.slice(1));
      }
    }
    return [...seen.values()].sort();
  }, [allFullNames]);

  // ── Filter helper: selected holds first names, match against full names ──

  const matchesFilter = (fullName) => {
    if (selectedPeople.size === 0) return true;
    const firstNames = extractFirstNames(fullName).map(w => w.toLowerCase());
    return [...selectedPeople].some(sel => firstNames.includes(sel.toLowerCase()));
  };

  const passesFilter = matchesFilter;

  // ── Filtered updates ──

  const filteredUpdates = useMemo(() => {
    if (selectedPeople.size === 0) return weekUpdates;
    return weekUpdates.filter(u => matchesFilter(u.person));
  }, [weekUpdates, selectedPeople, allFullNames]);

  const weekSummary = useMemo(() => {
    const taskIds = new Set(filteredUpdates.map(u => u.taskId));
    const totalBurned = filteredUpdates.reduce((s, u) => s + (u.deltaPts > 0 ? u.deltaPts : 0), 0);
    const newIssues = openIssues.filter(i => i.dateCreated && i.dateCreated >= rangeBounds.start);
    return { tasksUpdated: taskIds.size, pointsBurned: totalBurned, newIssues: newIssues.length };
  }, [filteredUpdates, openIssues, rangeBounds.start]);

  // ── Section 2: Blockers & Risks ──

  const offTrackItems = useMemo(() => {
    const items = [];
    for (const task of rows) {
      if (!passesFilter(task.assignee ?? 'Unknown')) continue;
      const key = `${task.Workstream ?? ''}|${task.Epic ?? ''}|${task.Deliverable ?? ''}|${task.taskName ?? ''}`;
      const s = taskSeries[key];
      if (s && isSeriesOffTrack(s)) {
        const totalPts = s.totalPoints ?? 0;
        const actual = s.actualData ?? [];
        const lastActual = actual.length > 0 ? actual[actual.length - 1] : null;
        const startTs = new Date(s.dateStarted).getTime();
        const endTs = new Date(s.dateExpectedComplete).getTime();
        const range = endTs - startTs;
        let idealAtDate = totalPts;
        if (lastActual && range > 0) {
          const t = new Date(lastActual.date).getTime();
          idealAtDate = t >= endTs ? 0 : totalPts * (1 - (t - startTs) / range);
        }
        const delta = lastActual ? lastActual.points - idealAtDate : 0;
        items.push({
          taskName: task.taskName,
          workstream: task.Workstream ?? '',
          deliverable: task.Deliverable ?? '',
          assignee: task.assignee ?? 'Unknown',
          delta: Math.round(delta * 10) / 10,
          pct: task.percentComplete ?? 0,
          url: task.url,
          task,
        });
      }
    }
    items.sort((a, b) => b.delta - a.delta);
    return items;
  }, [rows, taskSeries, selectedPeople]);

  const blockedTasks = useMemo(() => {
    return rows
      .filter(t => t.blockedBy && t.blockedBy.length > 0 && passesFilter(t.assignee ?? 'Unknown'))
      .map(t => ({
        taskName: t.taskName,
        workstream: t.Workstream ?? '',
        blockedByNames: t.blockedBy.map(b => b.name).join(', '),
        pct: t.percentComplete ?? 0,
        task: t,
      }));
  }, [rows, selectedPeople]);

  // ── Section 3: Per-Person Breakdown ──

  const personBreakdown = useMemo(() => {
    const byPerson = {};
    for (const u of filteredUpdates) {
      const name = u.person;
      if (!byPerson[name]) byPerson[name] = { updates: [], totalBurned: 0 };
      byPerson[name].updates.push(u);
      if (u.deltaPts > 0) byPerson[name].totalBurned += u.deltaPts;
    }

    const allAssigned = {};
    for (const task of rows) {
      const name = task.assignee ?? 'Unknown';
      if (!passesFilter(name)) continue;
      if (!allAssigned[name]) allAssigned[name] = new Set();
      allAssigned[name].add(task.taskId);
    }

    const updatedInRange = new Set(filteredUpdates.map(u => u.taskId));
    const taskById = new Map(rows.map(t => [t.taskId, t]));
    const result = [];
    const allNames = new Set([...Object.keys(byPerson), ...Object.keys(allAssigned)]);
    for (const name of [...allNames].sort()) {
      const person = byPerson[name] ?? { updates: [], totalBurned: 0 };
      const assigned = allAssigned[name] ?? new Set();
      const staleTasks = [...assigned]
        .filter(id => !updatedInRange.has(id))
        .map(id => taskById.get(id))
        .filter(Boolean)
        .map(t => ({ taskId: t.taskId, taskName: t.taskName, dateStarted: t.dateStarted, task: t }));
      if (person.updates.length === 0 && staleTasks.length === 0) continue;
      result.push({
        name,
        updates: person.updates,
        totalBurned: Math.round(person.totalBurned * 10) / 10,
        staleCount: staleTasks.length,
        staleTasks,
        totalAssigned: assigned.size,
      });
    }
    result.sort((a, b) => b.totalBurned - a.totalBurned);
    return result;
  }, [filteredUpdates, rows, selectedPeople]);


  // ── Section 4: Meeting Notes & Action Items (per-person) ──

  const wk = `${timeRange}_${rangeBounds.start}`;

  const notesPeople = useMemo(() => {
    const seen = new Map();
    for (const p of personBreakdown) {
      for (const raw of extractFirstNames(p.name)) {
        const key = raw.toLowerCase();
        if (!seen.has(key)) seen.set(key, raw.charAt(0).toUpperCase() + raw.slice(1));
      }
    }
    return ['General', ...[...seen.values()].sort()];
  }, [personBreakdown]);

  const [notesPerson, setNotesPerson] = useState('General');
  const [notes, setNotes] = useState(() => loadNotes(wk, 'General'));
  const [newItem, setNewItem] = useState('');
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => { saveNotes(wk, notesPerson, notesRef.current); }, [notes, wk, notesPerson]);

  useEffect(() => {
    setNotes(loadNotes(wk, notesPerson));
    setNewItem('');
  }, [wk, notesPerson]);

  const updateText = (text) => setNotes(prev => ({ ...prev, text }));
  const addItem = () => {
    if (!newItem.trim()) return;
    setNotes(prev => ({
      ...prev,
      items: [...prev.items, { id: Date.now(), text: newItem.trim(), done: false }],
    }));
    setNewItem('');
  };
  const toggleItem = (id) => {
    setNotes(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id ? { ...i, done: !i.done } : i),
    }));
  };
  const removeItem = (id) => {
    setNotes(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) }));
  };

  // ── Push to Notion ──

  const [pushState, setPushState] = useState({ status: 'idle', url: null, error: null });
  const [pushedPageId, setPushedPageId] = useState(() => loadPageId(wk));
  const [notesPushState, setNotesPushState] = useState({ status: 'idle', error: null });

  useEffect(() => { setPushedPageId(loadPageId(wk)); }, [wk]);

  const pushToNotion = async () => {
    setPushState({ status: 'pushing', url: null, error: null });
    try {
      const generalNotes = loadNotes(wk, 'General');
      const payload = {
        weekLabel: `Weekly Insights Review ${new Date(rangeBounds.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
        weekDate: rangeBounds.start,
        people: (() => {
          const byFirst = new Map();
          for (const p of personBreakdown) {
            const firsts = extractFirstNames(p.name);
            if (firsts.length === 0) firsts.push(p.name);
            for (const raw of firsts) {
              const key = raw.charAt(0).toUpperCase() + raw.slice(1);
              if (!byFirst.has(key)) byFirst.set(key, { name: key, updates: [], totalBurned: 0, staleCount: 0, totalAssigned: 0 });
              const entry = byFirst.get(key);
              entry.updates.push(...p.updates.map(u => ({ taskName: u.taskName, prevPct: u.prevPct, pct: u.pct, comment: u.comment })));
              entry.totalBurned += p.totalBurned;
              entry.staleCount += p.staleCount;
              entry.totalAssigned += p.totalAssigned;
            }
          }
          return [...byFirst.values()];
        })(),
        openIssues: openIssues.map(issue => ({
          name: issue.name || issue.issueName || '',
          severity: issue.severity || '',
          assignedTo: issue.assignedTo || '',
          workstream: issue.workstream || '',
          taskName: issue.taskName || issue.deliverable || '',
        })),
        notes: generalNotes.text,
        actionItems: generalNotes.items.map(i => ({ text: i.text, done: i.done })),
      };
      const res = await fetch('/api/meeting/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Push failed');
      savePageId(wk, data.id);
      setPushedPageId(data.id);
      setPushState({ status: 'success', url: data.url, error: null });
      setTimeout(() => setPushState(s => s.status === 'success' ? { ...s, status: 'idle' } : s), 8000);
    } catch (err) {
      setPushState({ status: 'error', url: null, error: err.message });
      setTimeout(() => setPushState(s => s.status === 'error' ? { ...s, status: 'idle' } : s), 6000);
    }
  };

  const pushPersonNotes = async () => {
    if (!pushedPageId) return;
    setNotesPushState({ status: 'pushing', error: null });
    try {
      const res = await fetch('/api/meeting/push-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: pushedPageId,
          personName: notesPerson === 'General' ? 'General' : notesPerson,
          notes: notes.text,
          actionItems: notes.items.map(i => ({ text: i.text, done: i.done })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Push failed');
      setNotesPushState({ status: 'success', error: null });
      setTimeout(() => setNotesPushState(s => s.status === 'success' ? { ...s, status: 'idle' } : s), 5000);
    } catch (err) {
      setNotesPushState({ status: 'error', error: err.message });
      setTimeout(() => setNotesPushState(s => s.status === 'error' ? { ...s, status: 'idle' } : s), 6000);
    }
  };

  // ── Collapsible sections ──

  const [expandedSections, setExpandedSections] = useState({
    diff: true, blockers: true, people: true, notes: true,
  });
  const toggleSection = (key) => setExpandedSections(s => ({ ...s, [key]: !s[key] }));

  return (
    <div className="weekly-meeting">
      <div className="meeting-top-bar">
        <div>
          <h2 className="meeting-title">Meeting &mdash; {rangeBounds.label}</h2>
          <p className="meeting-subtitle">{rangeBounds.subtitle}</p>
        </div>
        <div className="meeting-top-actions">
          <div className="meeting-range-selector">
            {['day', 'week', 'month', 'quarter'].map(r => (
              <button
                key={r}
                className={`meeting-range-btn${timeRange === r ? ' active' : ''}`}
                onClick={() => setTimeRange(r)}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
          <button
            className={`meeting-push-btn${pushState.status === 'pushing' ? ' pushing' : ''}`}
            onClick={pushToNotion}
            disabled={pushState.status === 'pushing'}
          >
            {pushState.status === 'pushing' ? 'Pushing…' : 'Push to Notion'}
          </button>
        </div>
      </div>
      {pushState.status === 'success' && (
        <div className="meeting-toast meeting-toast-success">
          Pushed to Notion!{' '}
          <a href={pushState.url} target="_blank" rel="noopener noreferrer">Open page &rarr;</a>
        </div>
      )}
      {pushState.status === 'error' && (
        <div className="meeting-toast meeting-toast-error">
          Push failed: {pushState.error}
        </div>
      )}

      {/* ── Week-over-Week Diff ── */}
      <section className="meeting-section">
        <div className="meeting-section-header" onClick={() => toggleSection('diff')}>
          <span className="meeting-arrow">{expandedSections.diff ? '\u25BE' : '\u25B8'}</span>
          <h3>{rangeBounds.label}'s Progress</h3>
        </div>
        {expandedSections.diff && (
          <div className="meeting-section-body">
            <div className="meeting-summary-cards">
              <div className="meeting-metric">
                <div className="meeting-metric-value">{weekSummary.tasksUpdated}</div>
                <div className="meeting-metric-label">Tasks Updated</div>
              </div>
              <div className="meeting-metric">
                <div className="meeting-metric-value">{weekSummary.pointsBurned.toFixed(1)}</div>
                <div className="meeting-metric-label">Points Burned</div>
              </div>
              <div className="meeting-metric">
                <div className="meeting-metric-value">{weekSummary.newIssues}</div>
                <div className="meeting-metric-label">New Issues</div>
              </div>
            </div>
            {filteredUpdates.length === 0 ? (
              <p className="meeting-empty">No updates logged for this period.</p>
            ) : (
              <table className="meeting-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Task</th>
                    <th>Updated By</th>
                    <th>Progress</th>
                    <th>Pts</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUpdates.map((u, i) => (
                    <tr key={`${u.taskId}-${u.date}-${i}`}>
                      <td className="meeting-td-date">{formatDate(u.date)}</td>
                      <td>
                        <button type="button" className="meeting-task-link" onClick={() => onNavigateToTask?.(u.task)}>
                          {u.taskName}
                        </button>
                      </td>
                      <td className="meeting-td-assignee">{u.userName}</td>
                      <td className="meeting-td-pct">{formatPct(u.prevPct)} &rarr; {formatPct(u.pct)}</td>
                      <td className="meeting-td-pts">{u.deltaPts > 0 ? `+${u.deltaPts.toFixed(1)}` : u.deltaPts.toFixed(1)}</td>
                      <td className="meeting-td-comment">{u.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* ── Blockers & Risks ── */}
      <section className="meeting-section">
        <div className="meeting-section-header" onClick={() => toggleSection('blockers')}>
          <span className="meeting-arrow">{expandedSections.blockers ? '\u25BE' : '\u25B8'}</span>
          <h3>Blockers &amp; Risks</h3>
          {(offTrackItems.length > 0 || openIssues.length > 0) && (
            <span className="meeting-badge-warn">{offTrackItems.length + openIssues.length}</span>
          )}
        </div>
        {expandedSections.blockers && (
          <div className="meeting-section-body">
            {offTrackItems.length > 0 && (
              <div className="meeting-subsection">
                <h4 className="meeting-sub-header">Off-Track Tasks ({offTrackItems.length})</h4>
                <table className="meeting-table meeting-table-compact">
                  <thead>
                    <tr><th>Task</th><th>Assignee</th><th>Workstream</th><th>Behind (pts)</th><th>Complete</th></tr>
                  </thead>
                  <tbody>
                    {offTrackItems.map((item, i) => (
                      <tr key={i}>
                        <td>
                          <button type="button" className="meeting-task-link" onClick={() => onNavigateToTask?.(item.task)}>
                            {item.taskName}
                          </button>
                        </td>
                        <td>{item.assignee}</td>
                        <td>{item.workstream}</td>
                        <td className="meeting-td-delta">+{item.delta}</td>
                        <td>{formatPct(item.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {openIssues.length > 0 && (
              <div className="meeting-subsection">
                <h4 className="meeting-sub-header">Open Issues ({openIssues.length})</h4>
                <table className="meeting-table meeting-table-compact">
                  <thead>
                    <tr><th>Issue</th><th>Assigned To</th><th>Severity</th><th>Workstream</th><th>Task / Deliverable</th></tr>
                  </thead>
                  <tbody>
                    {[...openIssues]
                      .sort((a, b) => {
                        const order = { high: 0, medium: 1, low: 2 };
                        return (order[(a.severity ?? '').toLowerCase()] ?? 3) - (order[(b.severity ?? '').toLowerCase()] ?? 3);
                      })
                      .map((issue, i) => {
                        let relatedTask = issue.relatedTaskId
                          ? rows.find(t => t.taskId === issue.relatedTaskId)
                          : null;
                        const taskLabel = issue.relatedTaskName || issue.taskName || issue.deliverable || '-';
                        if (!relatedTask && taskLabel !== '-') {
                          const label = taskLabel.trim().toLowerCase();
                          relatedTask = rows.find(t => (t.taskName ?? '').trim().toLowerCase() === label) || null;
                          if (!relatedTask) {
                            for (const ws of (data?.hierarchy ?? [])) {
                              for (const epic of (ws.epics ?? [])) {
                                if (epic.name?.trim().toLowerCase() === label && epic.tasks?.length > 0) {
                                  relatedTask = epic.tasks[0]; break;
                                }
                                for (const del of (epic.deliverables ?? [])) {
                                  if (del.name?.trim().toLowerCase() === label && del.tasks?.length > 0) {
                                    relatedTask = del.tasks[0]; break;
                                  }
                                }
                                if (relatedTask) break;
                              }
                              if (relatedTask) break;
                            }
                          }
                        }
                        return (
                          <tr key={i}>
                            <td>
                              {issue.url ? (
                                <a href={issue.url} target="_blank" rel="noopener noreferrer" className="meeting-task-link">
                                  {issue.name || issue.issueName || '-'}
                                </a>
                              ) : (issue.name || issue.issueName || '-')}
                            </td>
                            <td>{issue.assignedTo || '-'}</td>
                            <td>
                              <span className={`meeting-severity meeting-severity-${(issue.severity ?? '').toLowerCase()}`}>
                                {issue.severity || '-'}
                              </span>
                            </td>
                            <td>{issue.workstream || '-'}</td>
                            <td>
                              {relatedTask ? (
                                <button type="button" className="meeting-task-link" onClick={() => onNavigateToTask?.(relatedTask)}>
                                  {taskLabel}
                                </button>
                              ) : taskLabel}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {blockedTasks.length > 0 && (
              <div className="meeting-subsection">
                <h4 className="meeting-sub-header">Blocked Tasks ({blockedTasks.length})</h4>
                <table className="meeting-table meeting-table-compact">
                  <thead>
                    <tr><th>Task</th><th>Blocked By</th><th>Complete</th></tr>
                  </thead>
                  <tbody>
                    {blockedTasks.map((bt, i) => (
                      <tr key={i}>
                        <td>
                          <button type="button" className="meeting-task-link" onClick={() => onNavigateToTask?.(bt.task)}>
                            {bt.taskName}
                          </button>
                        </td>
                        <td>{bt.blockedByNames}</td>
                        <td>{formatPct(bt.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {offTrackItems.length === 0 && openIssues.length === 0 && blockedTasks.length === 0 && (
              <p className="meeting-empty">No blockers or risks for this period.</p>
            )}
          </div>
        )}
      </section>

      {/* ── Per-Person Breakdown ── */}
      <section className="meeting-section">
        <div className="meeting-section-header" onClick={() => toggleSection('people')}>
          <span className="meeting-arrow">{expandedSections.people ? '\u25BE' : '\u25B8'}</span>
          <h3>Per-Person Breakdown</h3>
        </div>
        {expandedSections.people && (
          <div className="meeting-section-body">
            <div className="meeting-person-filter-row">
              <PersonFilter allNames={firstNameOptions} selected={selectedPeople} onChange={setSelectedPeople} />
            </div>
            {personBreakdown.length === 0 ? (
              <p className="meeting-empty">No assignee data available.</p>
            ) : (
              <div className="meeting-person-grid">
                {personBreakdown.map(person => (
                  <div key={person.name} className="meeting-person-card">
                    <div className="meeting-person-header">
                      <span className="meeting-person-name">{person.name}</span>
                      <span className="meeting-person-pts">{person.totalBurned} pts burned</span>
                    </div>
                    {person.updates.length > 0 && (
                      <ul className="meeting-person-updates">
                        {person.updates.map((u, i) => (
                          <li key={i} className="meeting-person-update">
                            <button type="button" className="meeting-task-link" onClick={() => onNavigateToTask?.(u.task)}>
                              {u.taskName}
                            </button>
                            <span className="meeting-person-pct">{formatPct(u.prevPct)} &rarr; {formatPct(u.pct)}</span>
                            {u.comment && <span className="meeting-person-comment">"{u.comment}"</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {person.staleCount > 0 && (
                      <StaleTasksDropdown
                        staleCount={person.staleCount}
                        totalAssigned={person.totalAssigned}
                        staleTasks={person.staleTasks}
                        onNavigateToTask={onNavigateToTask}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Meeting Notes & Action Items ── */}
      <section className="meeting-section">
        <div className="meeting-section-header" onClick={() => toggleSection('notes')}>
          <span className="meeting-arrow">{expandedSections.notes ? '\u25BE' : '\u25B8'}</span>
          <h3>Meeting Notes</h3>
        </div>
        {expandedSections.notes && (
          <div className="meeting-section-body">
            <div className="meeting-notes-toolbar">
              <select
                className="meeting-notes-person-select"
                value={notesPerson}
                onChange={e => setNotesPerson(e.target.value)}
              >
                {notesPeople.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button
                className={`meeting-push-notes-btn${notesPushState.status === 'pushing' ? ' pushing' : ''}`}
                onClick={pushPersonNotes}
                disabled={notesPushState.status === 'pushing' || !pushedPageId}
                title={!pushedPageId ? 'Push the full meeting first using the top button' : `Push notes for ${notesPerson} to Notion`}
              >
                {notesPushState.status === 'pushing' ? 'Pushing…' : `Push ${notesPerson === 'General' ? '' : notesPerson + '\u2019s '}Notes`}
              </button>
            </div>
            {!pushedPageId && (
              <p className="meeting-notes-hint">Push the full meeting first (top button) before pushing individual notes.</p>
            )}
            {notesPushState.status === 'success' && (
              <div className="meeting-toast meeting-toast-success" style={{ marginBottom: 10 }}>Notes pushed to Notion!</div>
            )}
            {notesPushState.status === 'error' && (
              <div className="meeting-toast meeting-toast-error" style={{ marginBottom: 10 }}>Push failed: {notesPushState.error}</div>
            )}
            <textarea
              className="meeting-notes-textarea"
              placeholder={notesPerson === 'General' ? 'General meeting notes...' : `Notes / next week plan for ${notesPerson}...`}
              value={notes.text}
              onChange={e => updateText(e.target.value)}
              rows={5}
            />
          </div>
        )}
      </section>
    </div>
  );
}
