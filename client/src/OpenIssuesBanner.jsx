import React, { useState } from 'react';

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function severityColor(sev) {
  const s = (sev ?? '').toLowerCase();
  if (s.includes('critical') || s.includes('high')) return 'sev-high';
  if (s.includes('medium') || s.includes('moderate')) return 'sev-medium';
  if (s.includes('low')) return 'sev-low';
  return 'sev-none';
}

export default function OpenIssuesBanner({ issues }) {
  const [expanded, setExpanded] = useState(false);

  if (!issues || issues.length === 0) {
    return (
      <div className="issues-banner ok">
        <span className="issues-icon">&#10003;</span>
        <span>No open issues</span>
      </div>
    );
  }

  const openIssues = issues.filter(i => (i.status ?? '').toLowerCase() !== 'closed' && (i.status ?? '').toLowerCase() !== 'resolved');
  if (openIssues.length === 0) {
    return (
      <div className="issues-banner ok">
        <span className="issues-icon">&#10003;</span>
        <span>All issues resolved</span>
      </div>
    );
  }

  const workstreams = [...new Set(openIssues.map(i => i.workstream).filter(Boolean))];
  const bySeverity = {};
  for (const issue of openIssues) {
    const sev = issue.severity || 'Unspecified';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }
  const sevEntries = Object.entries(bySeverity).sort((a, b) => b[1] - a[1]);

  return (
    <div className="issues-banner warn">
      <div className="issues-summary" onClick={() => setExpanded(e => !e)}>
        <span className="issues-icon">&#9888;</span>
        <span className="issues-count">{openIssues.length} Open Issue{openIssues.length !== 1 ? 's' : ''}</span>
        <div className="issues-pills">
          {sevEntries.map(([sev, count]) => (
            <span key={sev} className={`sev-pill ${severityColor(sev)}`}>{count} {sev}</span>
          ))}
        </div>
        {workstreams.length > 0 && (
          <span className="issues-ws">Affected: {workstreams.join(', ')}</span>
        )}
        <span className="issues-toggle">{expanded ? '▾' : '▸'} Details</span>
      </div>
      {expanded && (
        <div className="issues-detail">
          <table className="issues-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Deliverable</th>
                <th>Task</th>
                <th>Assigned</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {openIssues.map(issue => (
                <tr key={issue.id}>
                  <td className="issue-name">
                    {issue.url ? (
                      <a href={issue.url} target="_blank" rel="noopener noreferrer" className="issue-notion-link">
                        {issue.name || issue.description || '-'} &#8599;
                      </a>
                    ) : (issue.name || issue.description || '-')}
                  </td>
                  <td><span className={`sev-pill ${severityColor(issue.severity)}`}>{issue.severity || '-'}</span></td>
                  <td>{issue.status}</td>
                  <td>{issue.deliverable || '-'}</td>
                  <td>{issue.relatedTaskName || '-'}</td>
                  <td>{issue.assignedTo || '-'}</td>
                  <td>{formatDate(issue.dateCreated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
