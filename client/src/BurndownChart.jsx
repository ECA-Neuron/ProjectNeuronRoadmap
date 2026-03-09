import React, { useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { isSeriesOffTrack } from './burndown';

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPct(v) {
  if (v == null) return '0%';
  return `${Math.round(v * 100)}%`;
}

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

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  const dateLabel = formatDate(new Date(data.ts).toISOString().slice(0, 10));
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
              {u.earlyProgress && <div className="chart-tooltip-early">Updated before expected start date</div>}
              {u.comment && <div className="chart-tooltip-comment">"{u.comment}"</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PercentBadge({ pct, totalPoints, currentPoints }) {
  const color = pct >= 0.75 ? 'var(--green)' : pct >= 0.25 ? 'var(--amber)' : 'var(--text-muted)';
  return (
    <div className="pct-badge" style={{ borderColor: color }}>
      <div className="pct-ring" style={{ background: `conic-gradient(${color} ${pct * 360}deg, var(--bg-hover) ${pct * 360}deg)` }}>
        <span className="pct-value">{formatPct(pct)}</span>
      </div>
      <span className="pct-label">{Math.round((currentPoints ?? 0) * 10) / 10} / {totalPoints ?? 0} pts</span>
    </div>
  );
}

export default function BurndownChart({ series, title, level, assignee, blockingItems, openIssues, tasks, onRefresh }) {
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateForm, setUpdateForm] = useState({ percentComplete: '', comment: '', userName: '' });
  const [updateStatus, setUpdateStatus] = useState(null);

  const taskObj = level === 'task' && tasks?.length === 1 ? tasks[0] : null;
  const taskId = taskObj?.taskId ?? null;
  const currentPctForForm = taskObj ? Math.round((taskObj.percentComplete ?? 0) * 100) : 0;

  const openUpdateModal = useCallback(() => {
    setUpdateForm({ percentComplete: String(currentPctForForm), comment: '', userName: '' });
    setUpdateStatus(null);
    setShowUpdateModal(true);
  }, [currentPctForForm]);

  const submitUpdate = useCallback(async () => {
    if (!taskId) return;
    const pct = parseInt(updateForm.percentComplete, 10);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setUpdateStatus({ type: 'error', msg: 'Percent must be 0–100' });
      return;
    }
    setUpdateStatus({ type: 'loading', msg: 'Pushing update...' });
    try {
      const resp = await fetch(`/api/task/${taskId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          percentComplete: pct,
          comment: updateForm.comment,
          userName: updateForm.userName,
          workstream: taskObj?.Workstream ?? '',
          epic: taskObj?.Epic ?? '',
          deliverable: taskObj?.Deliverable ?? '',
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to push update');
      }
      setUpdateStatus({ type: 'success', msg: 'Progress updated! Refreshing data...' });
      setTimeout(() => {
        setShowUpdateModal(false);
        setUpdateStatus(null);
        if (onRefresh) onRefresh();
      }, 3000);
    } catch (err) {
      setUpdateStatus({ type: 'error', msg: err.message });
    }
  }, [taskId, updateForm, onRefresh]);

  const relatedIssues = React.useMemo(() => {
    if (!openIssues?.length || !tasks?.length) return [];
    const taskIds = new Set(tasks.map(t => t.taskId));
    return openIssues.filter(issue => {
      if (!issue.relatedTaskId) return false;
      const status = (issue.status ?? '').toLowerCase();
      if (status === 'closed' || status === 'resolved') return false;
      return taskIds.has(issue.relatedTaskId);
    });
  }, [openIssues, tasks]);

  const updateModal = showUpdateModal ? (
    <div className="progress-modal-overlay" onClick={() => setShowUpdateModal(false)}>
      <div className="progress-modal" onClick={e => e.stopPropagation()}>
        <h4>Push Progress Update</h4>
        <label>
          Percent Complete (0–100)
          <input type="number" min="0" max="100" value={updateForm.percentComplete}
            onChange={e => setUpdateForm(f => ({ ...f, percentComplete: e.target.value }))} />
        </label>
        <label>
          Your Name (optional)
          <input type="text" value={updateForm.userName}
            onChange={e => setUpdateForm(f => ({ ...f, userName: e.target.value }))} placeholder="e.g. Anthony" />
        </label>
        <label>
          Reason / Comment
          <textarea rows={3} value={updateForm.comment}
            onChange={e => setUpdateForm(f => ({ ...f, comment: e.target.value }))} placeholder="What changed?" />
        </label>
        {updateStatus && (
          <div className={`progress-modal-status progress-modal-${updateStatus.type}`}>{updateStatus.msg}</div>
        )}
        <div className="progress-modal-actions">
          <button className="progress-modal-submit" onClick={submitUpdate}
            disabled={updateStatus?.type === 'loading'}>Push Update</button>
          <button className="progress-modal-cancel" onClick={() => setShowUpdateModal(false)}>Cancel</button>
        </div>
      </div>
    </div>
  ) : null;

  const updateButton = taskId ? (
    <button className="btn-update-progress" onClick={openUpdateModal} title="Push Progress Update">
      &#x1F4DD; Update Progress
    </button>
  ) : null;

  if (!series) {
    return (
      <div className="burndown-chart empty">
        <h3>{title}</h3>
        {updateButton}
        {updateModal}
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p className="empty-state-text">Select a node from the tree to view its burndown.</p>
        </div>
      </div>
    );
  }

  const totalPts = series.totalPoints ?? 0;
  const originalPts = series.originalPoints ?? totalPts;
  const hasAddedScope = originalPts !== totalPts;
  const currentPts = series.currentPoints ?? 0;
  const pct = series.pctComplete ?? (totalPts > 0 ? currentPts / totalPts : 0);
  const hasDate = series.dateStarted && series.dateExpectedComplete;

  if (!hasDate) {
    return (
      <div className="burndown-chart empty">
        <h3>{title}</h3>
        <div className="chart-top-row">
          <div className="chart-info" />
          <div className="chart-top-right">
            {updateButton}
            <PercentBadge pct={pct} totalPoints={totalPts} currentPoints={currentPts} />
          </div>
        </div>
        {updateModal}
        <p className="no-date-msg">No date provided</p>
      </div>
    );
  }

  const biweekly = generateWeeklyDates(series.dateStarted, series.dateExpectedComplete);
  const actual = (series.actualData ?? []);
  const actualInRange = actual.filter(d => d.date >= series.dateStarted);
  const actualDates = new Set(actualInRange.map(d => d.date));
  const allDates = new Set([...actualDates, series.dateStarted, series.dateExpectedComplete]);
  const sortedDates = [...allDates].sort();

  const startTs = new Date(series.dateStarted).getTime();
  const endTs = new Date(series.dateExpectedComplete).getTime();
  const lastActualDate = actualInRange.length > 0 ? actualInRange[actualInRange.length - 1].date : null;
  const lastActualTs = lastActualDate ? new Date(lastActualDate).getTime() : null;

  const ticksArr = [startTs];
  for (const d of biweekly) {
    const t = new Date(d).getTime();
    if (t > startTs && t < endTs) ticksArr.push(t);
  }
  ticksArr.push(endTs);

  const combined = sortedDates.map(date => {
    const t = new Date(date).getTime();

    const isStart = t === startTs;
    const isEnd = t === endTs;
    const idealVal = isStart ? originalPts : isEnd ? 0 : null;
    const adjustedVal = hasAddedScope ? (isStart ? totalPts : isEnd ? 0 : null) : null;

    let actualVal = null;
    let updates = [];
    if (t >= startTs && (lastActualTs == null || t <= lastActualTs)) {
      const actualPt = actual.filter(d => d.date <= date).pop();
      actualVal = actualPt?.points ?? totalPts;
      const exactPt = actual.find(d => d.date === date);
      if (exactPt?.updates?.length > 0) updates = exactPt.updates;
    }

    const earlyProgress = updates.some(u => u.earlyProgress);
    return { ts: t, date, ideal: idealVal, adjustedIdeal: adjustedVal, actual: actualVal, updates, earlyProgress };
  });
  combined.sort((a, b) => a.ts - b.ts);

  const offTrack = isSeriesOffTrack(series);

  return (
    <div className="burndown-chart">
      <h3>{title}</h3>
      {relatedIssues.length > 0 && (
        <div className="chart-issues-banner">
          <span className="chart-issues-icon">&#9888;</span>
          <div className="chart-issues-content">
            <strong>{relatedIssues.length} Open Issue{relatedIssues.length > 1 ? 's' : ''}</strong>
            <ul className="chart-issues-list">
              {relatedIssues.map((issue, i) => (
                <li key={i}>
                  <span className={`chart-issue-severity chart-issue-${(issue.severity ?? '').toLowerCase()}`}>
                    {issue.severity || 'Unknown'}
                  </span>
                  {' '}{issue.name || 'Unnamed issue'}
                  {issue.assignedTo ? <span className="chart-issue-assignee"> — {issue.assignedTo}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {offTrack && (
        <div className="off-track-flag">
          <span className="off-track-icon">&#9888;</span>
          <span>Off Track — actual remaining is above the ideal burndown</span>
          {blockingItems && blockingItems.length > 0 && (
            <div className="off-track-blocking-detail">
              <div className="off-track-blocking-header">
                Being off track will delay the following dependency tasks:
              </div>
              <ul className="off-track-blocking-list">
                {blockingItems.map((item, i) => (
                  <li key={i} className="off-track-blocking-item">
                    <span className="blocking-level">Workstream:</span> {item.blockedWorkstream}
                    <span className="blocking-sep">›</span>
                    <span className="blocking-level">Epic:</span> {item.blockedEpic}
                    <span className="blocking-sep">›</span>
                    <span className="blocking-level">Deliverable:</span> {item.blockedDeliverable}
                    <span className="blocking-sep">›</span>
                    <span className="blocking-level">Task:</span> {item.blockedTaskName}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="chart-top-row">
        <div className="chart-info">
          <span>Start: {formatDate(series.dateStarted)}</span>
          <span>End: {formatDate(series.dateExpectedComplete)}</span>
          <span>Total pts: {totalPts}</span>
          {assignee && assignee !== 'Unassigned' && <span className="chart-assignee">Assigned: {assignee}</span>}
        </div>
        <div className="chart-top-right">
          {updateButton}
          <PercentBadge pct={pct} totalPoints={totalPts} currentPoints={currentPts} />
        </div>
      </div>
      {updateModal}
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={combined} margin={{ top: 8, right: 20, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={[startTs, endTs]}
              ticks={ticksArr}
              tickFormatter={ts => formatDate(new Date(ts).toISOString().slice(0, 10))}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              stroke="var(--chart-stroke)"
            />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} stroke="var(--chart-stroke)" />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="var(--chart-stroke)" />
            <Line type="linear" dataKey="ideal" stroke="var(--chart-ideal)" strokeWidth={2} name="Ideal (Original)" dot={false} connectNulls />
            {hasAddedScope && (
              <Line type="linear" dataKey="adjustedIdeal" stroke="var(--chart-adjusted)" strokeWidth={2} strokeDasharray="6 3" name="Adjusted (w/ Added Scope)" dot={false} connectNulls />
            )}
            <Line type="linear" dataKey="actual" stroke="var(--chart-actual)" strokeWidth={2} name="Actual" dot={({ cx, cy, payload }) => {
              if (payload?.actual == null || cx == null || cy == null) return null;
              const fill = payload.earlyProgress ? 'var(--amber)' : 'var(--chart-actual)';
              return <circle key={payload.ts} cx={cx} cy={cy} r={payload.earlyProgress ? 5 : 3} fill={fill} stroke={fill} />;
            }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
