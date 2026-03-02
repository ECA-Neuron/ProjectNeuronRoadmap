import React from 'react';

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPct(v) {
  if (v == null) return '0%';
  return `${Math.round(v * 100)}%`;
}

export default function RecentUpdates({ tasks, level, onNavigateToTask }) {
  const updatedTasks = (tasks ?? [])
    .filter(t => t.progressRows && t.progressRows.length > 0)
    .map(t => {
      const latest = t.progressRows[t.progressRows.length - 1];
      return { ...t, latestUpdate: latest };
    })
    .sort((a, b) => (b.latestUpdate.date ?? '').localeCompare(a.latestUpdate.date ?? ''));

  if (updatedTasks.length === 0) {
    return (
      <div className="recent-updates">
        <h4>Recent Updates</h4>
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <p className="empty-state-text">No tasks have been updated yet under this {level}.</p>
        </div>
      </div>
    );
  }

  const grouped = new Map();
  for (const t of updatedTasks) {
    const delName = t.Deliverable ?? 'Unknown';
    if (!grouped.has(delName)) grouped.set(delName, []);
    grouped.get(delName).push(t);
  }

  return (
    <div className="recent-updates">
      <h4>Recently Updated Tasks</h4>
      {[...grouped.entries()].map(([deliverable, tasks]) => (
        <div key={deliverable} className="recent-group">
          {level !== 'deliverable' && <h5 className="recent-del-name">Deliverable: {deliverable}</h5>}
          <ul className="recent-list">
            {tasks.map(t => (
              <li key={t.taskId} className="recent-item">
                <button
                  type="button"
                  className="recent-link"
                  onClick={() => onNavigateToTask(t)}
                  title="Go to task burndown"
                >
                  {t.taskName}
                </button>
                <div className="recent-meta">
                  <span className="recent-user">{t.latestUpdate.userName || 'Unknown'}</span>
                  <span className="recent-date">{formatDate(t.latestUpdate.date)}</span>
                  <span className="recent-pct">{formatPct(t.latestUpdate.percentComplete)} complete</span>
                </div>
                {t.latestUpdate.comment && (
                  <p className="recent-comment">"{t.latestUpdate.comment}"</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
