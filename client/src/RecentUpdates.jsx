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

export default function RecentUpdates({ tasks, level, onNavigateToTask, openIssues }) {
  const issuesByTaskId = React.useMemo(() => {
    const map = new Map();
    for (const issue of (openIssues ?? [])) {
      if (!issue.relatedTaskId) continue;
      const status = (issue.status ?? '').toLowerCase();
      if (status === 'closed' || status === 'resolved') continue;
      if (!map.has(issue.relatedTaskId)) map.set(issue.relatedTaskId, []);
      map.get(issue.relatedTaskId).push(issue);
    }
    return map;
  }, [openIssues]);

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
            {tasks.map(t => {
              const taskIssues = issuesByTaskId.get(t.taskId) ?? [];
              return (
                <li key={t.taskId} className="recent-item">
                  <button
                    type="button"
                    className="recent-link"
                    onClick={() => onNavigateToTask(t)}
                    title="Go to task burndown"
                  >
                    {t.taskName}
                  </button>
                  {taskIssues.length > 0 && (
                    <div className="recent-issue-flags">
                      {taskIssues.map((issue, i) => (
                        <span key={i} className={`recent-issue-badge recent-issue-${(issue.severity ?? '').toLowerCase()}`}>
                          ⚠ {issue.name || 'Open Issue'}{issue.severity ? ` [${issue.severity}]` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="recent-meta">
                    <span className="recent-user">{t.latestUpdate.userName || 'Unknown'}</span>
                    <span className="recent-date">{formatDate(t.latestUpdate.date)}</span>
                    <span className="recent-pct">{formatPct(t.latestUpdate.percentComplete)} complete</span>
                  </div>
                  {t.latestUpdate.comment && (
                    <p className="recent-comment">"{t.latestUpdate.comment}"</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
