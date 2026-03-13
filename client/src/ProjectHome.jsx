import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { computeOffTrackCounts, computeLateBlockers } from './burndown';

function formatDateShortNoYear(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ProjectTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  const dateLabel = formatDateShortNoYear(new Date(data.ts).toISOString().slice(0, 10));
  const updates = data.updates ?? [];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{dateLabel}</div>
      <div className="chart-tooltip-values">
        {data.ideal != null && (
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-dot" style={{ background: 'var(--chart-ideal)' }} />
            <span>Ideal (Original):</span>
            <strong>{data.ideal.toFixed(1)}</strong>
          </div>
        )}
        {data.adjustedIdeal != null && (
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-dot" style={{ background: 'var(--chart-adjusted)' }} />
            <span>Adjusted (w/ Added Scope):</span>
            <strong>{data.adjustedIdeal.toFixed(1)}</strong>
          </div>
        )}
        {data.actual != null && (
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-dot" style={{ background: 'var(--chart-actual)' }} />
            <span>Actual:</span>
            <strong>{data.actual.toFixed(1)}</strong>
          </div>
        )}
      </div>
      {updates.length > 0 && (
        <div className="chart-tooltip-updates">
          {updates.map((u, i) => (
            <div key={i} className="chart-tooltip-update">
              <div className="chart-tooltip-task">{u.taskName}</div>
              <div className="chart-tooltip-meta">
                {u.userName && <span>{u.userName}</span>}
                <span>{Math.round((u.prevPct ?? 0) * 100)}% → {Math.round((u.pct ?? 0) * 100)}%</span>
              </div>
              {u.comment && <div className="chart-tooltip-comment">"{u.comment}"</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(str) {
  if (!str) return '-';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPct(v) {
  return `${Math.round((v ?? 0) * 100)}%`;
}

function chartUpdateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `Updated chart: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

const STORAGE_KEY = 'erp_project_delivery_date';
const LOCK_KEY = 'erp_project_delivery_locked';

function mondayOf(d) {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function generateWeeklyDates(startStr, endStr) {
  if (!startStr || !endStr) return [];
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
  const dates = [];
  const current = mondayOf(start);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 7);
  }
  return dates;
}

function OffTrackSection({ label, count, items }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="off-track-section">
      <div className="off-track-section-header" onClick={() => setOpen(o => !o)}>
        <span className="off-track-arrow">{open ? '▾' : '▸'}</span>
        <span className="off-track-num">{count}</span>
        <span className="off-track-label">{label}{count !== 1 ? 's' : ''}</span>
      </div>
      {open && items.length > 0 && (
        <ul className="off-track-name-list">
          {items.map((item, i) => {
            const name = typeof item === 'string' ? item : item.name;
            const url = typeof item === 'string' ? null : item.url;
            return (
              <li key={i} className="off-track-name-item">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="off-track-name-link">
                    {name} <span className="notion-icon">&#8599;</span>
                  </a>
                ) : name}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OffTrackPanel({ offTrack, lateBlockerSummary }) {
  return (
    <div className="off-track-summary">
      <div className="off-track-header">
        <span className="off-track-icon">&#9888;</span>
        <span className="off-track-title">Off Track for Delivery</span>
      </div>
      <OffTrackSection label="Workstream" count={offTrack.workstreams} items={offTrack.offTrackNames.workstreams} />
      <OffTrackSection label="Epic" count={offTrack.epics} items={offTrack.offTrackNames.epics} />
      <OffTrackSection label="Deliverable" count={offTrack.deliverables} items={offTrack.offTrackNames.deliverables} />
      <OffTrackSection label="Task" count={offTrack.tasks} items={offTrack.offTrackNames.tasks} />
      {lateBlockerSummary && lateBlockerSummary.length > 0 && (
        <OffTrackSection
          label="Task blocked by late dependency"
          count={lateBlockerSummary.length}
          items={lateBlockerSummary.map(b => `${b.blockedTaskName} ← blocked by ${b.blockerName}`)}
        />
      )}
    </div>
  );
}

function OpenIssuesPanel({ openIssues, onNavigateToIssues }) {
  const affectedWorkstreams = useMemo(() => {
    const map = {};
    for (const i of openIssues) {
      const ws = i.workstream || 'Unassigned';
      if (!map[ws]) map[ws] = [];
      map[ws].push(i);
    }
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [openIssues]);

  const affectedDeliverables = useMemo(() => {
    const set = new Set();
    for (const i of openIssues) if (i.deliverable) set.add(i.deliverable);
    return [...set].sort();
  }, [openIssues]);

  const affectedTasks = useMemo(() => {
    const set = new Set();
    for (const i of openIssues) if (i.relatedTaskName) set.add(i.relatedTaskName);
    return [...set].sort();
  }, [openIssues]);

  const highCount = openIssues.filter(i => {
    const s = (i.severity ?? '').toLowerCase();
    return s.includes('high') || s.includes('critical');
  }).length;

  if (openIssues.length === 0) return null;

  return (
    <div className="open-issues-summary">
      <div className="off-track-header">
        <span className="off-track-icon" style={{ color: 'var(--amber)' }}>&#9888;</span>
        <span className="off-track-title">Open Issues</span>
        <span className="open-issues-total">{openIssues.length} issue{openIssues.length !== 1 ? 's' : ''}</span>
        {highCount > 0 && <span className="open-issues-high">{highCount} High</span>}
      </div>
      <OffTrackSection
        label="Affected Workstream"
        count={affectedWorkstreams.length}
        items={affectedWorkstreams.map(([ws, issues]) => `${ws} (${issues.length} issue${issues.length !== 1 ? 's' : ''})`)}
      />
      <OffTrackSection
        label="Affected Deliverable"
        count={affectedDeliverables.length}
        items={affectedDeliverables}
      />
      <OffTrackSection
        label="Affected Task"
        count={affectedTasks.length}
        items={affectedTasks}
      />
      <OffTrackSection
        label="Issue"
        count={openIssues.length}
        items={openIssues.map(i => ({
          name: `${i.name || i.description || 'Unnamed'} — ${(i.severity || 'Unspecified')}${i.workstream ? ` · ${i.workstream}` : ''}`,
          url: i.url
        }))}
      />
      {onNavigateToIssues && (
        <button type="button" className="open-issues-view-btn" onClick={onNavigateToIssues}>
          View all issues →
        </button>
      )}
    </div>
  );
}

export default function ProjectHome({ data, taskSeries, onSelectNode, onNavigateToTask, onNavigateToIssues }) {
  const rows = data?.roadmapRows ?? [];
  const hierarchy = data?.hierarchy ?? [];
  const openIssues = (data?.openIssues ?? []).filter(
    i => (i.status ?? '').toLowerCase() !== 'closed' && (i.status ?? '').toLowerCase() !== 'resolved'
  );

  const totalPoints = rows.reduce((s, t) => s + (t.totalPoints ?? 0), 0);
  const originalTotalPoints = rows.reduce((s, t) => {
    const isAdded = (t.typeOfScope ?? '').toLowerCase().includes('added');
    return s + (isAdded ? 0 : (t.totalPoints ?? 0));
  }, 0);
  const hasAddedScope = originalTotalPoints !== totalPoints;
  const currentPoints = rows.reduce((s, t) => s + (t.currentPoints ?? 0), 0);
  const remainingPoints = Math.max(0, totalPoints - currentPoints);
  const pctComplete = totalPoints > 0 ? currentPoints / totalPoints : 0;
  const totalTasks = rows.length;
  const completedTasks = rows.filter(t => (t.percentComplete ?? 0) >= 1).length;
  const workstreamCount = hierarchy.length;

  const earliestStart = rows
    .map(t => t.dateStarted).filter(Boolean).sort()[0] ?? null;
  const latestEnd = rows
    .map(t => t.dateExpectedComplete).filter(Boolean).sort().pop() ?? null;

  const offTrack = useMemo(
    () => computeOffTrackCounts(hierarchy, taskSeries, {}),
    [hierarchy, taskSeries]
  );
  const lateBlockerSummary = useMemo(
    () => computeLateBlockers(rows, taskSeries),
    [rows, taskSeries]
  );
  const totalOffTrack = offTrack.tasks + offTrack.deliverables + offTrack.epics + offTrack.workstreams;

  const [deliveryDate, setDeliveryDate] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || '2027-12-31'; } catch { return '2027-12-31'; }
  });
  const [locked, setLocked] = useState(() => {
    try { return localStorage.getItem(LOCK_KEY) === 'true'; } catch { return true; }
  });

  useEffect(() => {
    if (!deliveryDate && latestEnd) setDeliveryDate(latestEnd);
  }, [latestEnd]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, deliveryDate); } catch {}
  }, [deliveryDate]);
  useEffect(() => {
    try { localStorage.setItem(LOCK_KEY, String(locked)); } catch {}
  }, [locked]);

  const projectBurndown = useMemo(() => {
    if (!earliestStart || !deliveryDate) return null;
    const start = earliestStart;
    const end = deliveryDate;

    const biweekly = generateWeeklyDates(start, end);
    const ticks = biweekly.filter(d => d > start);

    const today = new Date().toISOString().slice(0, 10);
    const dateSet = new Set();
    if (start) dateSet.add(start);
    Object.values(taskSeries).forEach(s =>
      (s.actualData ?? []).forEach(d => {
        const effectiveDate = d.originalDate ?? d.date;
        if (effectiveDate <= today) dateSet.add(effectiveDate);
      })
    );
    const sortedDates = [...dateSet].sort();

    const seriesList = Object.values(taskSeries);
    const rawActual = sortedDates.map(date => {
      let points = 0;
      const updates = [];
      for (const s of seriesList) {
        const arr = s.actualData ?? [];
        const last = arr.filter(d => (d.originalDate ?? d.date) <= date).pop();
        if (last) {
          points += last.points;
          const matchDate = last.originalDate ?? last.date;
          if (matchDate === date && last.updates?.length > 0) updates.push(...last.updates);
        }
        else points += s.totalPoints;
      }
      return { date, points, updates };
    });

    const actualData = [{ date: start, points: totalPoints, updates: [] }];
    for (const pt of rawActual) {
      if (pt.date === start && pt.points === totalPoints) continue;
      actualData.push(pt);
    }
    const startTs = new Date(start).getTime();
    const endTs = new Date(end).getTime();
    const range = endTs > startTs ? endTs - startTs : 1;

    const ticksArr = [startTs];
    for (const d of biweekly) {
      const t = new Date(d).getTime();
      if (t > startTs && t < endTs) ticksArr.push(t);
    }
    ticksArr.push(endTs);

    const lastActualDate = actualData.length > 0 ? actualData[actualData.length - 1].date : null;
    const lastActualTs = lastActualDate ? new Date(lastActualDate).getTime() : null;

    const allDates = new Set([...actualData.map(d => d.date), start, end]);
    const combined = [...allDates].sort().map(date => {
      const t = new Date(date).getTime();

      const isStart = t === startTs;
      const isEnd = t === endTs;
      const idealVal = isStart ? originalTotalPoints : isEnd ? 0 : null;
      const adjustedVal = hasAddedScope ? (isStart ? totalPoints : isEnd ? 0 : null) : null;

      let actualVal = null;
      let updates = [];
      if (t >= startTs && (lastActualTs == null || t <= lastActualTs)) {
        const actualPt = actualData.filter(d => d.date <= date).pop();
        actualVal = actualPt?.points ?? totalPoints;
        const exactPt = actualData.find(d => d.date === date);
        if (exactPt?.updates?.length > 0) updates = exactPt.updates;
      }

      return { ts: t, date, ideal: idealVal, adjustedIdeal: adjustedVal, actual: actualVal, updates };
    });

    return { combined, biweekly, ticksArr, startTs, endTs, hasAddedScope };
  }, [taskSeries, earliestStart, deliveryDate, totalPoints, originalTotalPoints, hasAddedScope]);

  const weeklyBurnedData = useMemo(() => {
    const weekMap = {};
    for (const task of rows) {
      const tp = task.totalPoints ?? 0;
      const cp = task.currentPoints ?? 0;
      if (tp <= 0) continue;
      const pRows = task.progressRows ?? [];
      const rawDeltas = [];
      let rawTotal = 0;
      for (let i = 0; i < pRows.length; i++) {
        const pct = pRows[i].percentComplete ?? 0;
        const prevPct = i > 0 ? (pRows[i - 1].percentComplete ?? 0) : 0;
        const delta = ((pct - prevPct) / 100) * tp;
        if (delta <= 0) continue;
        const dateStr = (pRows[i].date ?? '').slice(0, 10);
        if (!dateStr) continue;
        rawDeltas.push({ dateStr, delta });
        rawTotal += delta;
      }
      const scale = rawTotal > 0 ? cp / rawTotal : 0;
      for (const { dateStr, delta } of rawDeltas) {
        const parsed = new Date(dateStr + 'T00:00:00');
        if (isNaN(parsed.getTime())) continue;
        const weekMon = mondayOf(parsed).toISOString().slice(0, 10);
        if (!weekMap[weekMon]) weekMap[weekMon] = 0;
        weekMap[weekMon] += delta * scale;
      }
    }
    return Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mon, pts]) => ({ week: formatDateShortNoYear(mon), pts: Math.round(pts * 10) / 10 }));
  }, [rows]);

  const wsBreakdown = hierarchy.map(ws => {
    const tp = ws.totalPoints ?? 0;
    const cp = ws.currentPoints ?? 0;
    return { name: ws.name, totalPoints: tp, currentPoints: cp, pct: tp > 0 ? cp / tp : 0 };
  });

  const wsNames = useMemo(() => hierarchy.map(ws => ws.name), [hierarchy]);

  const monthlyWsData = useMemo(() => {
    if (!rows.length) return { assignedData: [], burnedData: [] };

    const assignedMap = {};
    const burnedMap = {};
    const allMonths = new Set();

    function allDaysBetween(s, e) {
      const days = [];
      const cur = new Date(s + 'T00:00:00Z');
      const end = new Date(e + 'T00:00:00Z');
      while (cur <= end) {
        days.push(cur.toISOString().slice(0, 7));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return days;
    }

    for (const task of rows) {
      const ws = task.Workstream ?? 'Other';
      const tp = task.totalPoints ?? 0;
      const start = task.dateStarted;
      const end = task.dateExpectedComplete;

      if (start && tp > 0) {
        const endDate = end || start;
        const monthSet = new Set(allDaysBetween(start, endDate));
        const months = [...monthSet];
        if (months.length > 0) {
          const ptsPerMonth = tp / months.length;
          for (const m of months) {
            allMonths.add(m);
            const ak = `${ws}|${m}`;
            assignedMap[ak] = (assignedMap[ak] ?? 0) + ptsPerMonth;
          }
        }
      }

      const cp = task.currentPoints ?? 0;
      const pRows = task.progressRows ?? [];
      const rawDeltas = [];
      let rawTotal = 0;
      for (let i = 0; i < pRows.length; i++) {
        const pct = pRows[i].percentComplete ?? 0;
        const prevPct = i > 0 ? (pRows[i - 1].percentComplete ?? 0) : 0;
        const delta = ((pct - prevPct) / 100) * tp;
        if (delta <= 0) continue;
        const d = (pRows[i].date ?? '').slice(0, 7);
        if (!d) continue;
        rawDeltas.push({ month: d, delta });
        rawTotal += delta;
      }
      const scale = rawTotal > 0 ? cp / rawTotal : 0;
      for (const { month, delta } of rawDeltas) {
        allMonths.add(month);
        const bk = `${ws}|${month}`;
        burnedMap[bk] = (burnedMap[bk] ?? 0) + delta * scale;
      }
      if (cp > 0 && rawDeltas.length === 0 && start) {
        const m = start.slice(0, 7);
        allMonths.add(m);
        const bk = `${ws}|${m}`;
        burnedMap[bk] = (burnedMap[bk] ?? 0) + cp;
      }
    }

    const sorted = [...allMonths].sort();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = ym => {
      const [y, m] = ym.split('-');
      return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
    };

    const assignedData = sorted.map(m => {
      const row = { month: label(m) };
      for (const ws of wsNames) {
        row[ws] = Math.round((assignedMap[`${ws}|${m}`] ?? 0) * 10) / 10;
      }
      return row;
    });

    const burnedData = sorted.map(m => {
      const row = { month: label(m) };
      for (const ws of wsNames) {
        row[ws] = Math.round((burnedMap[`${ws}|${m}`] ?? 0) * 10) / 10;
      }
      return row;
    });

    return { assignedData, burnedData };
  }, [rows, wsNames]);

  const WS_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

  const WsMonthTooltip = React.useCallback(({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
    return (
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
        {payload.filter(p => p.value > 0).map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color }}>
            <span>{p.name}</span>
            <span>{Math.round(p.value * 10) / 10}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', gap: 16, fontWeight: 700 }}>
          <span>Total</span>
          <span>{Math.round(total * 10) / 10}</span>
        </div>
      </div>
    );
  }, []);

  const recentUpdates = useMemo(() => {
    const MAX_RECENT = 15;
    return rows
      .filter(t => t.progressRows && t.progressRows.length > 0)
      .map(t => {
        const latest = t.progressRows[t.progressRows.length - 1];
        return { ...t, latestUpdate: latest };
      })
      .sort((a, b) => (b.latestUpdate.date ?? '').localeCompare(a.latestUpdate.date ?? ''))
      .slice(0, MAX_RECENT);
  }, [rows]);

  const daysToDelivery = deliveryDate
    ? Math.ceil((new Date(deliveryDate) - new Date()) / 86400000)
    : null;

  return (
    <div className="project-home">
      <h2 className="home-title">Project Overview</h2>

      <div className="home-metrics">
        <div className="metric-card accent">
          <div className="metric-value">{formatPct(pctComplete)}</div>
          <div className="metric-label">Complete</div>
          <div className="metric-bar">
            <div className="metric-bar-fill" style={{ width: `${pctComplete * 100}%` }} />
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{totalPoints}</div>
          <div className="metric-label">Total Points</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{currentPoints}</div>
          <div className="metric-label">Completed Pts</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{remainingPoints}</div>
          <div className="metric-label">Remaining Pts</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{completedTasks} / {totalTasks}</div>
          <div className="metric-label">Tasks Done</div>
        </div>
        <div className="metric-card">
          <div className="metric-value">{workstreamCount}</div>
          <div className="metric-label">Workstreams</div>
        </div>
        <div className="metric-card">
          <div className="metric-value issue-val">{openIssues.length}</div>
          <div className="metric-label">Open Issues</div>
        </div>
        <div className={`metric-card ${daysToDelivery != null && daysToDelivery < 0 ? 'overdue' : ''}`}>
          <div className="metric-value">{daysToDelivery != null ? `${daysToDelivery}d` : '-'}</div>
          <div className="metric-label">To Delivery</div>
        </div>
      </div>

      {totalOffTrack > 0 && (
        <OffTrackPanel offTrack={offTrack} lateBlockerSummary={lateBlockerSummary} />
      )}

      <OpenIssuesPanel openIssues={openIssues} onNavigateToIssues={onNavigateToIssues} />

      <div className="home-delivery">
        <div className="delivery-row">
          <span className="delivery-label">Project Delivery Date</span>
          <div className="delivery-input-group">
            <input
              type="date"
              className="delivery-date-input"
              value={deliveryDate}
              onChange={e => setDeliveryDate(e.target.value)}
              disabled={locked}
            />
            <button
              type="button"
              className={`delivery-lock-btn ${locked ? 'locked' : 'unlocked'}`}
              onClick={() => setLocked(l => !l)}
              title={locked ? 'Unlock to edit delivery date' : 'Lock delivery date'}
            >
              {locked ? '\uD83D\uDD12' : '\uD83D\uDD13'}
            </button>
          </div>
          <span className="delivery-hint">
            {locked ? 'Locked — click the lock to edit' : 'Unlocked — pick a date, then lock'}
          </span>
        </div>
        <div className="delivery-dates-row">
          <span>Earliest task start: <strong>{formatDate(earliestStart)}</strong></span>
          <span>Latest task end: <strong>{formatDate(latestEnd)}</strong></span>
        </div>
      </div>

      {projectBurndown && (
        <div className="home-chart">
          <h3>Project Burndown</h3>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={projectBurndown.combined} margin={{ top: 8, right: 20, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[projectBurndown.startTs, projectBurndown.endTs]}
                ticks={projectBurndown.ticksArr}
                tickFormatter={ts => formatDateShort(new Date(ts).toISOString().slice(0, 10))}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                stroke="var(--chart-stroke)"
              />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} stroke="var(--chart-stroke)" />
              <Tooltip content={<ProjectTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="linear" dataKey="ideal" stroke="var(--chart-ideal)" strokeWidth={2} name="Ideal (Original)" dot={false} connectNulls />
              {projectBurndown.hasAddedScope && (
                <Line type="linear" dataKey="adjustedIdeal" stroke="var(--chart-adjusted)" strokeWidth={2} strokeDasharray="6 3" name="Adjusted (w/ Added Scope)" dot={false} connectNulls />
              )}
              <Line type="linear" dataKey="actual" stroke="var(--chart-actual)" strokeWidth={2} name="Actual" dot={{ r: 3, fill: 'var(--chart-actual)' }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {weeklyBurnedData.length > 0 && (
        <div className="home-ws-chart">
          <h3>Points Burned — Week over Week</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={weeklyBurnedData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} label={{ value: 'Points', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }}
                formatter={(value) => [value, 'Points Burned']}
              />
              <Bar dataKey="pts" name="Points Burned" fill="var(--accent)" radius={[4, 4, 0, 0]} barSize={28}>
                {weeklyBurnedData.map((entry, i) => {
                  const isCurrentWeek = i === weeklyBurnedData.length - 1;
                  return <Cell key={i} fill={isCurrentWeek ? 'var(--green)' : 'var(--accent)'} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="home-ws-breakdown">
        <h3>Workstream Breakdown</h3>
        <div className="ws-grid">
          {wsBreakdown.map(ws => (
            <div
              key={ws.name}
              className="ws-card"
              onClick={() => onSelectNode?.({ type: 'workstream', name: ws.name })}
            >
              <div className="ws-card-name">{ws.name}</div>
              <div className="ws-card-pct">{formatPct(ws.pct)}</div>
              <div className="ws-card-bar">
                <div className="ws-card-bar-fill" style={{ width: `${ws.pct * 100}%` }} />
              </div>
              <div className="ws-card-pts">{ws.currentPoints} / {ws.totalPoints} pts</div>
            </div>
          ))}
        </div>
      </div>

      {wsBreakdown.length > 0 && (
        <div className="home-ws-chart">
          <h3>Points by Workstream</h3>
          <ResponsiveContainer width="100%" height={Math.max(220, wsBreakdown.length * 44)}>
            <BarChart data={wsBreakdown} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }}
                formatter={(value, name) => [Math.round(value * 10) / 10, name]}
              />
              <Legend />
              <Bar dataKey="totalPoints" name="Total" fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={18} />
              <Bar dataKey="currentPoints" name="Completed" fill="var(--green)" radius={[0, 4, 4, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {monthlyWsData.assignedData.length > 0 && (
        <div className="home-ws-chart">
          <h3>Points Assigned per Month by Workstream</h3>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={monthlyWsData.assignedData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} label={{ value: 'Points', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 12 }} />
              <Tooltip content={<WsMonthTooltip />} />
              <Legend />
              {wsNames.map((ws, i) => (
                <Bar key={ws} dataKey={ws} stackId="a" fill={WS_COLORS[i % WS_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {monthlyWsData.burnedData.length > 0 && (
        <div className="home-ws-chart">
          <h3>Points Burned per Month by Workstream</h3>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={monthlyWsData.burnedData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} label={{ value: 'Points', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 12 }} />
              <Tooltip content={<WsMonthTooltip />} />
              <Legend />
              {wsNames.map((ws, i) => (
                <Bar key={ws} dataKey={ws} stackId="a" fill={WS_COLORS[i % WS_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="home-recent-updates">
        <h3>Recent Task Updates</h3>
        {recentUpdates.length === 0 ? (
          <p className="no-updates">No task updates yet.</p>
        ) : (
          <ul className="home-recent-list">
            {recentUpdates.map(t => (
              <li key={t.taskId} className="home-recent-item">
                <div className="home-recent-row">
                  <button
                    type="button"
                    className="home-recent-link"
                    onClick={() => onNavigateToTask?.(t)}
                    title="Go to task burndown"
                  >
                    {t.taskName}
                  </button>
                  <span className="home-recent-ws">{t.Workstream}</span>
                </div>
                <div className="home-recent-meta">
                  <span className="home-recent-user">{t.latestUpdate.userName || 'Unknown'}</span>
                  <span className="home-recent-date">{formatDate(t.latestUpdate.date)}</span>
                  <span className="home-recent-pct">
                    {formatPct(t.latestUpdate.prevPercentComplete)} → {formatPct(t.latestUpdate.percentComplete)}
                  </span>
                </div>
                <div className="home-recent-week">{chartUpdateLabel(t.latestUpdate.date)}</div>
                {t.latestUpdate.comment && (
                  <p className="home-recent-comment">"{t.latestUpdate.comment}"</p>
                )}
                {(t.blockedBy?.length > 0 || t.blocking?.length > 0) && (
                  <div className="home-recent-deps">
                    {t.blockedBy?.length > 0 && (
                      <span className="home-recent-dep">
                        <span className="dep-icon">&#x1F6D1;</span> Blocked by: {t.blockedBy.map(b => b.name).join(', ')}
                      </span>
                    )}
                    {t.blocking?.length > 0 && (
                      <span className="home-recent-dep">
                        <span className="dep-icon">&#x26A0;</span> Blocking: {t.blocking.map(b => b.name).join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
