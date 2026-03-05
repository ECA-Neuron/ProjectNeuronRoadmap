import React from 'react';
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
      <span className="pct-label">{currentPoints ?? 0} / {totalPoints ?? 0} pts</span>
    </div>
  );
}

export default function BurndownChart({ series, title, level, assignee, blockingItems }) {
  if (!series) {
    return (
      <div className="burndown-chart empty">
        <h3>{title}</h3>
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
        <PercentBadge pct={pct} totalPoints={totalPts} currentPoints={currentPts} />
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
        <PercentBadge pct={pct} totalPoints={totalPts} currentPoints={currentPts} />
      </div>
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
