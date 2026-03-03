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

function chartUpdateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `Updated chart: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function severityClass(sev) {
  const s = (sev ?? '').toLowerCase();
  if (s.includes('critical') || s.includes('high')) return 'high';
  if (s.includes('medium') || s.includes('moderate')) return 'medium';
  if (s.includes('low')) return 'low';
  return 'none';
}

function ProgressBar({ value, prev }) {
  const pct = Math.min(1, Math.max(0, value ?? 0));
  const prevPct = Math.min(1, Math.max(0, prev ?? 0));
  return (
    <div className="progress-bar-wrap">
      <div className="progress-bar">
        {prevPct > 0 && prevPct < pct && (
          <div className="progress-prev" style={{ width: `${prevPct * 100}%` }} />
        )}
        <div className="progress-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="progress-label">
        {prevPct > 0 && prevPct !== pct
          ? `${formatPct(prevPct)} → ${formatPct(pct)}`
          : formatPct(pct)
        }
      </span>
    </div>
  );
}

export default function TaskDetail({ task, openIssues, lateBlockers }) {
  if (!task) return null;

  const progressRows = task.progressRows ?? [];
  const hasUpdates = progressRows.length > 0;
  const taskIssues = (openIssues ?? []).filter(
    i => i.relatedTaskId === task.taskId
      && (i.status ?? '').toLowerCase() !== 'closed'
      && (i.status ?? '').toLowerCase() !== 'resolved'
  );

  const blockedBy = task.blockedBy ?? [];
  const blocking = task.blocking ?? [];
  const taskLateBlockers = (lateBlockers ?? []).filter(b => b.blockedTaskId === task.taskId);

  return (
    <div className="task-detail">
      <div className="task-detail-header">
        <h4>{task.taskName}</h4>
        {taskLateBlockers.length > 0 && (
          <div className="late-blocker-banner">
            <span className="late-blocker-icon">&#9888;</span>
            <span className="late-blocker-text">
              Blocked by {taskLateBlockers.length} off-track {taskLateBlockers.length === 1 ? 'task' : 'tasks'}:
            </span>
            <ul className="late-blocker-list">
              {taskLateBlockers.map(b => (
                <li key={b.blockerTaskId} className="late-blocker-item">
                  {b.blockerName}
                </li>
              ))}
            </ul>
          </div>
        )}
        {taskIssues.length > 0 && (
          <div className="task-issues-badge">
            <span className="task-issues-icon">&#9888;</span>
            <span className="task-issues-count">{taskIssues.length} Open Issue{taskIssues.length !== 1 ? 's' : ''}</span>
            <div className="task-issues-list">
              {taskIssues.map(issue => (
                <div key={issue.id} className="task-issue-row">
                  {issue.url ? (
                    <a href={issue.url} target="_blank" rel="noopener noreferrer" className="task-issue-name task-issue-link">
                      {issue.name || issue.description || 'Untitled issue'} &#8599;
                    </a>
                  ) : (
                    <span className="task-issue-name">{issue.name || issue.description || 'Untitled issue'}</span>
                  )}
                  {issue.severity && <span className={`sev-pill sev-${severityClass(issue.severity)}`}>{issue.severity}</span>}
                  <span className="task-issue-meta">
                    Created {formatDate(issue.dateCreated)}
                    {issue.assignedTo ? ` · ${issue.assignedTo}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(blockedBy.length > 0 || blocking.length > 0) && (
          <div className="task-dependencies">
            {blockedBy.length > 0 && (
              <div className="dep-group dep-blocked-by">
                <span className="dep-label">Blocked by:</span>
                <div className="dep-tags">
                  {blockedBy.map(b => (
                    <span key={b.id} className="dep-tag dep-tag-blocker">{b.name}</span>
                  ))}
                </div>
              </div>
            )}
            {blocking.length > 0 && (
              <div className="dep-group dep-blocking">
                <span className="dep-label">Blocking:</span>
                <div className="dep-tags">
                  {blocking.map(b => (
                    <span key={b.id} className="dep-tag dep-tag-blocking">{b.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="task-stats">
          <span>Total: {task.totalPoints ?? 0} pts</span>
          <span>Current: {task.currentPoints ?? 0} pts</span>
          <span>Remaining: {task.remainingPoints ?? 0} pts</span>
          {task.assignee && task.assignee !== 'Unassigned' && (
            <span className="task-assignee">Assigned: {task.assignee}</span>
          )}
        </div>
        <div className="task-meta-row">
          {task.status && <span className="task-meta-pill status-pill">{task.status}</span>}
          {task.levelOfRisk && <span className={`task-meta-pill risk-pill risk-${(task.levelOfRisk).toLowerCase()}`}>{task.levelOfRisk} Risk</span>}
          {task.typeOfScope && (
            <span className={`task-meta-pill scope-pill ${(task.typeOfScope).toLowerCase().includes('added') ? 'scope-added' : 'scope-original'}`}>
              {task.typeOfScope} Scope
            </span>
          )}
          {task.estimatedDays != null && <span className="task-meta-pill days-pill">{task.estimatedDays} Est. Day{task.estimatedDays !== 1 ? 's' : ''}</span>}
          {task.url && (
            <a href={task.url} target="_blank" rel="noopener noreferrer" className="task-meta-pill notion-pill" title="Open in Notion">
              Open in Notion &#8599;
            </a>
          )}
        </div>
        {task.text && (
          <div className="task-text-block">
            <span className="task-text-label">Notes</span>
            <p className="task-text-content">{task.text}</p>
          </div>
        )}
        <ProgressBar value={task.percentComplete} prev={progressRows.length > 1 ? progressRows[progressRows.length - 2]?.percentComplete : 0} />
      </div>

      <div className="comment-log">
        <h5>Update Log</h5>
        {!hasUpdates && <p className="no-updates">No updates yet.</p>}
        {hasUpdates && (
          <ul className="comment-list">
            {[...progressRows].reverse().map((row, i) => (
              <li key={i} className="comment-item">
                <div className="comment-header">
                  <span className="comment-user">{row.userName || 'Unknown'}</span>
                  <span className="comment-date">{formatDate(row.date)}</span>
                </div>
                <div className="comment-week">{chartUpdateLabel(row.date)}</div>
                {row.comment && <p className="comment-text">{row.comment}</p>}
                <div className="comment-meta">
                  <span>Completion: {formatPct(row.prevPercentComplete)} → {formatPct(row.percentComplete)}</span>
                  {row.pointsAdded > 0 && <span>+{row.pointsAdded} pts added</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
