import React, { useState, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const ADMIN_PASSWORD = 'neuron123';

const COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#10b981',
];

const GRANULARITIES = ['Week', 'Month', 'Quarter', 'Year'];

/* ── period bucketing helpers ── */

function toISOWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function toMonth(dateStr) { return dateStr.slice(0, 7); }

function toQuarter(dateStr) {
  const m = parseInt(dateStr.slice(5, 7), 10);
  return `${dateStr.slice(0, 4)}-Q${Math.ceil(m / 3)}`;
}

function toYear(dateStr) { return dateStr.slice(0, 4); }

function getBucketFn(gran) {
  if (gran === 'Week') return toISOWeek;
  if (gran === 'Quarter') return toQuarter;
  if (gran === 'Year') return toYear;
  return toMonth;
}

function periodLabel(key, gran) {
  if (gran === 'Week') {
    const [y, w] = key.split('-W');
    return `W${parseInt(w, 10)} ${y}`;
  }
  if (gran === 'Month') {
    const [y, m] = key.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  }
  if (gran === 'Quarter') return key.replace('-', ' ');
  return key;
}

function allDaysBetween(startStr, endStr) {
  const days = [];
  const s = new Date(startStr + 'T00:00:00Z');
  const e = new Date(endStr + 'T00:00:00Z');
  const cur = new Date(s);
  while (cur <= e) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

function heatColor(value, max) {
  if (!value || !max) return 'transparent';
  const intensity = Math.min(value / max, 1);
  return `rgba(59, 130, 246, ${0.1 + intensity * 0.6})`;
}

function burnHeatColor(value, max) {
  if (!value || !max) return 'transparent';
  const intensity = Math.min(value / max, 1);
  return `rgba(34, 197, 94, ${0.1 + intensity * 0.6})`;
}

/* ── main component ── */

export default function AdminPage({ roadmapRows }) {
  const [authed, setAuthed] = useState(() => {
    try { return sessionStorage.getItem('admin_authed') === 'true'; } catch { return false; }
  });
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState(false);
  const [gran, setGran] = useState('Month');
  const [heatMode, setHeatMode] = useState('loaded');

  const handleLogin = useCallback(() => {
    if (pw === ADMIN_PASSWORD) {
      setAuthed(true);
      setPwError(false);
      try { sessionStorage.setItem('admin_authed', 'true'); } catch {}
    } else {
      setPwError(true);
    }
  }, [pw]);

  /* per-person assigned & burned by period (for the bar chart) */
  const { personPeriodChart, aggData, personLoadedMap, personBurnedMap, people, periods } = useMemo(() => {
    if (!roadmapRows?.length) return { personPeriodChart: [], aggData: [], personLoadedMap: {}, personBurnedMap: {}, people: [], periods: [] };

    const bucket = getBucketFn(gran);
    const pLoaded = {};
    const pBurned = {};
    const loadedAgg = {};
    const burnedAgg = {};
    const allPeriods = new Set();
    const allPeople = new Set();

    for (const task of roadmapRows) {
      const start = task.dateStarted;
      const end = task.dateExpectedComplete;
      const tp = task.totalPoints ?? 0;
      const raw = (task.assignee ?? 'Unassigned').trim();
      const names = raw.includes(',') ? raw.split(',').map(n => n.trim()).filter(Boolean) : [raw];

      if (start && tp > 0) {
        const endDate = end || start;
        const days = allDaysBetween(start, endDate);
        if (days.length > 0) {
          const ptsPerDay = tp / days.length;
          const periodAccum = {};
          for (const day of days) {
            const period = bucket(day);
            periodAccum[period] = (periodAccum[period] ?? 0) + ptsPerDay;
          }
          for (const [period, pts] of Object.entries(periodAccum)) {
            allPeriods.add(period);
            loadedAgg[period] = (loadedAgg[period] ?? 0) + pts;
            for (const n of names) {
              allPeople.add(n);
              const pk = `${n}|${period}`;
              pLoaded[pk] = (pLoaded[pk] ?? 0) + pts;
            }
          }
        }
      }

      const cp = task.currentPoints ?? 0;
      const rows = task.progressRows ?? [];
      const rawDeltas = [];
      let rawTotal = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const pct = row.percentComplete ?? 0;
        const prevPct = i > 0 ? (rows[i - 1].percentComplete ?? 0) : 0;
        const delta = ((pct - prevPct) / 100) * tp;
        if (delta <= 0) continue;
        const d = (row.date ?? '').slice(0, 10);
        if (!d) continue;
        rawDeltas.push({ period: bucket(d), delta });
        rawTotal += delta;
      }
      const scale = rawTotal > 0 ? cp / rawTotal : 0;
      for (const { period, delta } of rawDeltas) {
        const scaled = delta * scale;
        allPeriods.add(period);
        burnedAgg[period] = (burnedAgg[period] ?? 0) + scaled;
        for (const n of names) {
          allPeople.add(n);
          const pk = `${n}|${period}`;
          pBurned[pk] = (pBurned[pk] ?? 0) + scaled;
        }
      }
      if (cp > 0 && rawDeltas.length === 0) {
        const fallbackPeriod = start ? bucket(start) : bucket(new Date().toISOString().slice(0, 10));
        allPeriods.add(fallbackPeriod);
        burnedAgg[fallbackPeriod] = (burnedAgg[fallbackPeriod] ?? 0) + cp;
        for (const n of names) {
          allPeople.add(n);
          const pk = `${n}|${fallbackPeriod}`;
          pBurned[pk] = (pBurned[pk] ?? 0) + cp;
        }
      }
    }

    const sorted = [...allPeriods].sort();
    const sortedPeople = [...allPeople].sort();

    const agg = sorted.map(p => ({
      period: periodLabel(p, gran),
      periodKey: p,
      Loaded: Math.round((loadedAgg[p] ?? 0) * 10) / 10,
      Burned: Math.round((burnedAgg[p] ?? 0) * 10) / 10,
    }));

    /* build per-person horizontal bar data using actual currentPoints for accuracy */
    const personDirect = {};
    for (const task of roadmapRows) {
      const raw = (task.assignee ?? 'Unassigned').trim();
      const names = raw.includes(',') ? raw.split(',').map(n => n.trim()).filter(Boolean) : [raw];
      const tp = task.totalPoints ?? 0;
      const cp = task.currentPoints ?? 0;
      for (const n of names) {
        if (!personDirect[n]) personDirect[n] = { assigned: 0, burned: 0 };
        personDirect[n].assigned += tp;
        personDirect[n].burned += cp;
      }
    }
    const chart = Object.entries(personDirect)
      .map(([n, v]) => ({
        name: n,
        Assigned: Math.round(v.assigned * 10) / 10,
        Burned: Math.round(v.burned * 10) / 10,
      }))
      .sort((a, b) => b.Assigned - a.Assigned);

    return { personPeriodChart: chart, aggData: agg, personLoadedMap: pLoaded, personBurnedMap: pBurned, people: sortedPeople, periods: sorted };
  }, [roadmapRows, gran]);

  const { maxLoaded, maxBurned } = useMemo(() => {
    let mL = 0, mB = 0;
    for (const person of people) {
      for (const period of periods) {
        const pk = `${person}|${period}`;
        const lv = personLoadedMap[pk] ?? 0;
        const bv = personBurnedMap[pk] ?? 0;
        if (lv > mL) mL = lv;
        if (bv > mB) mB = bv;
      }
    }
    return { maxLoaded: mL, maxBurned: mB };
  }, [people, periods, personLoadedMap, personBurnedMap]);

  const r = v => Math.round((v ?? 0) * 10) / 10;

  if (!authed) {
    return (
      <div className="admin-gate">
        <div className="admin-gate-card">
          <h2>Admin Access</h2>
          <p>Enter the admin password to continue.</p>
          <div className="admin-gate-input-row">
            <input
              type="password"
              className="admin-gate-input"
              value={pw}
              onChange={e => { setPw(e.target.value); setPwError(false); }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Password"
              autoFocus
            />
            <button type="button" className="admin-gate-btn" onClick={handleLogin}>Unlock</button>
          </div>
          {pwError && <p className="admin-gate-error">Incorrect password.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      {/* ── Header with granularity toggle ── */}
      <div className="admin-section-header" style={{ marginBottom: 24 }}>
        <h2 className="admin-title">Points by Person</h2>
        <div className="admin-gran-toggle">
          {GRANULARITIES.map(g => (
            <button
              key={g}
              type="button"
              className={`admin-gran-btn ${gran === g ? 'active' : ''}`}
              onClick={() => setGran(g)}
            >{g}</button>
          ))}
        </div>
      </div>

      {/* ── Points by Person (horizontal bar, scoped to selected period range) ── */}
      {personPeriodChart.length > 0 && (
        <div className="admin-chart-wrap" style={{ marginBottom: 32 }}>
          <ResponsiveContainer width="100%" height={Math.max(220, personPeriodChart.length * 44)}>
            <BarChart data={personPeriodChart} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }}
                formatter={(value, name) => [Math.round(value * 10) / 10, name]}
              />
              <Legend />
              <Bar dataKey="Assigned" fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={18} />
              <Bar dataKey="Burned" fill="var(--green)" radius={[0, 4, 4, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Heat Map: per-person per-period ── */}
      {people.length > 0 && periods.length > 0 && (
        <>
          <div className="admin-section-header" style={{ marginTop: 8 }}>
            <h3 className="admin-title" style={{ fontSize: '1.1rem' }}>Resource Heat Map — per {gran}</h3>
            <div className="admin-gran-toggle">
              <button type="button" className={`admin-gran-btn ${heatMode === 'loaded' ? 'active' : ''}`} onClick={() => setHeatMode('loaded')}>Loaded</button>
              <button type="button" className={`admin-gran-btn admin-gran-btn-green ${heatMode === 'burned' ? 'active' : ''}`} onClick={() => setHeatMode('burned')}>Burned</button>
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table admin-heat-table">
              <thead>
                <tr>
                  <th className="admin-heat-person-th">Person</th>
                  {periods.map(p => <th key={p} className="admin-heat-period-th">{periodLabel(p, gran)}</th>)}
                  <th className="admin-heat-period-th">Total</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person, i) => {
                  const dataMap = heatMode === 'loaded' ? personLoadedMap : personBurnedMap;
                  const maxVal = heatMode === 'loaded' ? maxLoaded : maxBurned;
                  const colorFn = heatMode === 'loaded' ? heatColor : burnHeatColor;
                  let total = 0;
                  return (
                    <tr key={person}>
                      <td className="admin-person-cell">
                        <span className="admin-color-dot" style={{ background: COLORS[i % COLORS.length] }} />
                        {person}
                      </td>
                      {periods.map(period => {
                        const val = r(dataMap[`${person}|${period}`] ?? 0);
                        total += val;
                        return (
                          <td key={period} className="admin-heat-cell" style={{ background: colorFn(val, maxVal) }}>
                            {val || <span className="admin-heat-zero">-</span>}
                          </td>
                        );
                      })}
                      <td className="admin-heat-cell admin-total-cell">{r(total)}</td>
                    </tr>
                  );
                })}
                <tr className="admin-agg-row">
                  <td className="admin-person-cell" style={{ fontWeight: 700 }}>Total</td>
                  {aggData.map(d => {
                    const val = heatMode === 'loaded' ? d.Loaded : d.Burned;
                    return <td key={d.periodKey} className="admin-heat-cell" style={{ fontWeight: 600 }}>{val || '-'}</td>;
                  })}
                  <td className="admin-heat-cell admin-total-cell">
                    {r(aggData.reduce((s, d) => s + (heatMode === 'loaded' ? d.Loaded : d.Burned), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
