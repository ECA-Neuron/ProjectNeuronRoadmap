import React, { useState, useMemo } from 'react';

function formatDate(str) {
  if (!str) return '-';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function severityColor(sev) {
  const s = (sev ?? '').toLowerCase();
  if (s.includes('critical') || s.includes('high')) return 'sev-high';
  if (s.includes('medium') || s.includes('moderate')) return 'sev-medium';
  if (s.includes('low')) return 'sev-low';
  return 'sev-none';
}

function severityRank(sev) {
  const s = (sev ?? '').toLowerCase();
  if (s.includes('critical')) return 0;
  if (s.includes('high')) return 1;
  if (s.includes('medium') || s.includes('moderate')) return 2;
  if (s.includes('low')) return 3;
  return 4;
}

function IssueRow({ issue }) {
  const [open, setOpen] = useState(false);
  const comments = issue.comments ?? [];
  const hasComments = comments.length > 0;
  return (
    <>
      <tr className={open ? 'issue-row-expanded' : ''}>
        <td className="issues-page-name">
          <div className="issue-name-row">
            <button
              type="button"
              className={`issue-comment-toggle ${hasComments ? 'has-comments' : ''} ${open ? 'is-open' : ''}`}
              onClick={() => hasComments && setOpen(o => !o)}
              title={hasComments ? (open ? 'Hide comments' : `Show ${comments.length} comment${comments.length > 1 ? 's' : ''}`) : 'No comments'}
              disabled={!hasComments}
            >
              <span className="toggle-chevron">{hasComments ? (open ? '▾' : '▸') : ''}</span>
              <span className="toggle-icon">💬</span>
              <span className="issue-comment-count">{comments.length}</span>
            </button>
            <div className="issue-name-text">
              {issue.url ? (
                <a href={issue.url} target="_blank" rel="noopener noreferrer" className="issues-page-link" title="Open in Notion">
                  {issue.name || issue.description || '-'}
                  <span className="notion-icon">&#8599;</span>
                </a>
              ) : (
                issue.name || issue.description || '-'
              )}
              {issue.description && issue.name && (
                <div className="issues-page-desc">{issue.description}</div>
              )}
            </div>
          </div>
        </td>
        <td><span className={`sev-pill ${severityColor(issue.severity)}`}>{issue.severity || '-'}</span></td>
        <td>{issue.status || '-'}</td>
        <td>{issue.category || '-'}</td>
        <td>{issue.workstream || '-'}</td>
        <td>{issue.deliverable || '-'}</td>
        <td>{issue.relatedTaskName || '-'}</td>
        <td>{issue.assignedTo || '-'}</td>
        <td>{formatDate(issue.dateCreated)}</td>
      </tr>
      {open && hasComments && (
        <tr className="issue-comments-row">
          <td colSpan={9}>
            <div className="issue-comments-panel">
              <div className="issue-comments-title">Comments ({comments.length})</div>
              {comments.map((c, i) => (
                <div key={i} className="issue-comment-item">
                  <div className="issue-comment-text">{c.text}</div>
                  <div className="issue-comment-meta">{formatDate(c.createdTime)}</div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function OpenIssuesPage({ issues }) {
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterWorkstream, setFilterWorkstream] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sortBy, setSortBy] = useState('severity');

  const openIssues = useMemo(() =>
    (issues ?? []).filter(i =>
      (i.status ?? '').toLowerCase() !== 'closed' &&
      (i.status ?? '').toLowerCase() !== 'resolved'
    ), [issues]);

  const severities = useMemo(() => [...new Set(openIssues.map(i => i.severity).filter(Boolean))].sort((a, b) => severityRank(a) - severityRank(b)), [openIssues]);
  const workstreams = useMemo(() => [...new Set(openIssues.map(i => i.workstream).filter(Boolean))].sort(), [openIssues]);
  const statuses = useMemo(() => [...new Set(openIssues.map(i => i.status).filter(Boolean))].sort(), [openIssues]);
  const categories = useMemo(() => [...new Set(openIssues.map(i => i.category).filter(Boolean))].sort(), [openIssues]);

  const bySeverity = useMemo(() => {
    const m = {};
    for (const i of openIssues) { const s = i.severity || 'Unspecified'; m[s] = (m[s] ?? 0) + 1; }
    return Object.entries(m).sort((a, b) => severityRank(a[0]) - severityRank(b[0]));
  }, [openIssues]);

  const filtered = useMemo(() => {
    let list = openIssues;
    if (filterSeverity) list = list.filter(i => i.severity === filterSeverity);
    if (filterWorkstream) list = list.filter(i => i.workstream === filterWorkstream);
    if (filterStatus) list = list.filter(i => i.status === filterStatus);
    if (filterCategory) list = list.filter(i => i.category === filterCategory);

    list = [...list].sort((a, b) => {
      if (sortBy === 'severity') return severityRank(a.severity) - severityRank(b.severity);
      if (sortBy === 'date') return (b.dateCreated ?? '').localeCompare(a.dateCreated ?? '');
      if (sortBy === 'workstream') return (a.workstream ?? '').localeCompare(b.workstream ?? '');
      return 0;
    });
    return list;
  }, [openIssues, filterSeverity, filterWorkstream, filterStatus, filterCategory, sortBy]);

  const byWorkstream = useMemo(() => {
    const m = {};
    for (const i of openIssues) { const w = i.workstream || 'Unassigned'; m[w] = (m[w] ?? 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [openIssues]);

  return (
    <div className="issues-page">
      <h2 className="issues-page-title">Open Issues</h2>

      <div className="issues-page-metrics">
        <div className="metric-card">
          <div className="metric-value issue-val">{openIssues.length}</div>
          <div className="metric-label">Total Open</div>
        </div>
        {bySeverity.map(([sev, count]) => (
          <div key={sev} className="metric-card">
            <div className="metric-value">
              <span className={`sev-pill ${severityColor(sev)}`}>{count}</span>
            </div>
            <div className="metric-label">{sev}</div>
          </div>
        ))}
        <div className="metric-card">
          <div className="metric-value">{byWorkstream.length}</div>
          <div className="metric-label">Affected Workstreams</div>
        </div>
      </div>

      <div className="issues-page-ws-breakdown">
        <h3>By Workstream</h3>
        <div className="issues-page-ws-grid">
          {byWorkstream.map(([ws, count]) => (
            <div
              key={ws}
              className={`issues-page-ws-card ${filterWorkstream === ws ? 'active' : ''}`}
              onClick={() => setFilterWorkstream(f => f === ws ? '' : ws)}
            >
              <div className="issues-page-ws-count">{count}</div>
              <div className="issues-page-ws-name">{ws}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="issues-page-filters">
        <select className="filter-select" value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
          <option value="">All severities</option>
          {severities.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={filterWorkstream} onChange={e => setFilterWorkstream(e.target.value)}>
          <option value="">All workstreams</option>
          {workstreams.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {categories.length > 0 && (
          <select className="filter-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="severity">Sort: Severity</option>
          <option value="date">Sort: Newest</option>
          <option value="workstream">Sort: Workstream</option>
        </select>
      </div>

      <div className="issues-page-count">
        Showing {filtered.length} of {openIssues.length} issues
      </div>

      <div className="issues-page-table-wrap">
        <table className="issues-page-table">
          <thead>
            <tr>
              <th>Issue</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Category</th>
              <th>Workstream</th>
              <th>Deliverable</th>
              <th>Task</th>
              <th>Assigned</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="issues-page-empty">No issues match the current filters.</td></tr>
            ) : filtered.map(issue => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
