import React, { useState, useMemo, useCallback } from 'react';
import NewIssueModal from './NewIssueModal';

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

const SEVERITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];
const STATUS_OPTIONS = ['Open', 'In Progress', 'Resolved', 'Closed'];

function IssueRow({ issue, onRefresh, onOptimistic }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState({});
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(null);

  const comments = issue.comments ?? [];
  const hasComments = comments.length > 0;

  const startEdit = useCallback(() => {
    setEditing(true);
    setOpen(true);
    setEditFields({
      status: issue.status || '',
      severity: issue.severity || '',
      assignedTo: issue.assignedTo || '',
    });
  }, [issue]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditFields({});
    setNewComment('');
    setSaving(null);
  }, []);

  const saveFields = useCallback(async () => {
    const changed = {};
    if (editFields.status && editFields.status !== (issue.status || '')) changed.status = editFields.status;
    if (editFields.severity && editFields.severity !== (issue.severity || '')) changed.severity = editFields.severity;
    if (editFields.assignedTo !== undefined && editFields.assignedTo !== (issue.assignedTo || '')) changed.assignedTo = editFields.assignedTo;

    const hasFieldChanges = Object.keys(changed).length > 0;
    const hasComment = newComment.trim().length > 0;
    if (!hasFieldChanges && !hasComment) { cancelEdit(); return; }

    setSaving('saving');

    const optimistic = { ...changed };
    if (hasComment) {
      optimistic._newComment = { text: newComment.trim(), createdTime: new Date().toISOString() };
    }
    onOptimistic(issue.id, optimistic);

    try {
      if (hasFieldChanges) {
        const resp = await fetch(`/api/issue/${issue.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changed),
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Update failed'); }
      }
      if (hasComment) {
        const resp = await fetch(`/api/issue/${issue.id}/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: newComment.trim() }),
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Comment failed'); }
      }
      setSaving('saved');
      setNewComment('');
      setTimeout(() => {
        setEditing(false);
        setSaving(null);
        if (onRefresh) onRefresh();
      }, 1200);
    } catch (err) {
      setSaving('error:' + err.message);
    }
  }, [editFields, newComment, issue, cancelEdit, onRefresh, onOptimistic]);

  return (
    <>
      <tr className={`${open ? 'issue-row-expanded' : ''} ${editing ? 'issue-row-editing' : ''}`}>
        <td className="issues-page-name">
          <div className="issue-name-row">
            <button
              type="button"
              className={`issue-comment-toggle ${hasComments ? 'has-comments' : ''} ${open ? 'is-open' : ''}`}
              onClick={() => setOpen(o => !o)}
              title={hasComments ? (open ? 'Hide comments' : `Show ${comments.length} comment${comments.length > 1 ? 's' : ''}`) : 'No comments'}
            >
              <span className="toggle-chevron">{hasComments || editing ? (open ? '▾' : '▸') : ''}</span>
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
        <td>
          {editing ? (
            <select className="issue-edit-select" value={editFields.severity} onChange={e => setEditFields(f => ({ ...f, severity: e.target.value }))}>
              <option value="">-</option>
              {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <span className={`sev-pill ${severityColor(issue.severity)}`}>{issue.severity || '-'}</span>
          )}
        </td>
        <td>
          {editing ? (
            <select className="issue-edit-select" value={editFields.status} onChange={e => setEditFields(f => ({ ...f, status: e.target.value }))}>
              <option value="">-</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (issue.status || '-')}
        </td>
        <td>{issue.category || '-'}</td>
        <td>{issue.workstream || '-'}</td>
        <td>{issue.deliverable || '-'}</td>
        <td>{issue.relatedTaskName || '-'}</td>
        <td>
          {editing ? (
            <input className="issue-edit-input" type="text" value={editFields.assignedTo} onChange={e => setEditFields(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Assignee" />
          ) : (issue.assignedTo || '-')}
        </td>
        <td className="issue-actions-cell">
          {editing ? (
            <div className="issue-edit-inline-actions">
              {saving === 'saving' && <span className="issue-edit-status issue-edit-saving">Saving...</span>}
              {saving === 'saved' && <span className="issue-edit-status issue-edit-saved">Saved!</span>}
              {saving?.startsWith('error:') && <span className="issue-edit-status issue-edit-error">{saving.slice(6)}</span>}
              <button type="button" className="issue-edit-save" onClick={saveFields} disabled={saving === 'saving'}>Save</button>
              <button type="button" className="issue-edit-cancel" onClick={cancelEdit}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="issue-edit-btn" onClick={startEdit} title="Edit issue">Edit</button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="issue-comments-row">
          <td colSpan={9}>
            <div className="issue-comments-panel">
              {comments.length > 0 && (
                <>
                  <div className="issue-comments-title">Comments ({comments.length})</div>
                  {comments.map((c, i) => (
                    <div key={i} className="issue-comment-item">
                      <div className="issue-comment-text">{c.text}</div>
                      <div className="issue-comment-meta">{formatDate(c.createdTime)}</div>
                    </div>
                  ))}
                </>
              )}
              {editing && (
                <div className="issue-edit-panel">
                  <textarea
                    className="issue-edit-textarea"
                    rows={2}
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Add a comment to push to Notion..."
                  />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function OpenIssuesPage({ issues, hierarchy, roadmapRows, onRefresh }) {
  const [activeTab, setActiveTab] = useState('open');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterWorkstream, setFilterWorkstream] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [sortBy, setSortBy] = useState('severity');
  const [overrides, setOverrides] = useState({});
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [optimisticIssues, setOptimisticIssues] = useState([]);

  const applyOptimistic = useCallback((issueId, changes) => {
    setOverrides(prev => {
      const cur = prev[issueId] ?? {};
      const next = { ...cur };
      if (changes.status) next.status = changes.status;
      if (changes.severity) next.severity = changes.severity;
      if (changes.assignedTo !== undefined) next.assignedTo = changes.assignedTo;
      if (changes._newComment) next._newComments = [...(cur._newComments ?? []), changes._newComment];
      return { ...prev, [issueId]: next };
    });
  }, []);

  const addOptimisticIssue = useCallback((issue) => {
    setOptimisticIssues(prev => [...prev, issue]);
  }, []);

  const mergedIssues = useMemo(() => {
    const base = (issues ?? []).map(iss => {
      const ov = overrides[iss.id];
      if (!ov) return iss;
      const merged = { ...iss };
      if (ov.status) merged.status = ov.status;
      if (ov.severity) merged.severity = ov.severity;
      if (ov.assignedTo !== undefined) merged.assignedTo = ov.assignedTo;
      if (ov._newComments?.length) merged.comments = [...(iss.comments ?? []), ...ov._newComments];
      return merged;
    });
    return [...base, ...optimisticIssues];
  }, [issues, overrides, optimisticIssues]);

  const openIssues = useMemo(() =>
    mergedIssues.filter(i =>
      (i.status ?? '').toLowerCase() !== 'closed' &&
      (i.status ?? '').toLowerCase() !== 'resolved'
    ), [mergedIssues]);

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

  const resolvedIssues = useMemo(() =>
    mergedIssues.filter(i => {
      const s = (i.status ?? '').toLowerCase();
      return s === 'closed' || s === 'resolved';
    }).sort((a, b) => (b.dateCreated ?? '').localeCompare(a.dateCreated ?? '')),
  [mergedIssues]);

  const handleRefresh = useCallback(() => {
    setOverrides({});
    setOptimisticIssues([]);
    if (onRefresh) onRefresh();
  }, [onRefresh]);

  return (
    <div className="issues-page">
      <div className="issues-page-title-row">
        <h2 className="issues-page-title">Issues</h2>
        <button type="button" className="new-issue-btn" onClick={() => setShowNewIssue(true)}>+ New Issue</button>
      </div>

      <div className="issues-tab-bar">
        <button type="button" className={`issues-tab ${activeTab === 'open' ? 'active' : ''}`} onClick={() => setActiveTab('open')}>
          Open <span className="issues-tab-count">{openIssues.length}</span>
        </button>
        <button type="button" className={`issues-tab ${activeTab === 'resolved' ? 'active' : ''}`} onClick={() => setActiveTab('resolved')}>
          Resolved <span className="issues-tab-count">{resolvedIssues.length}</span>
        </button>
      </div>

      {showNewIssue && (
        <NewIssueModal hierarchy={hierarchy} roadmapRows={roadmapRows} onClose={() => setShowNewIssue(false)} onRefresh={handleRefresh} onOptimisticCreate={addOptimisticIssue} />
      )}

      {activeTab === 'open' && (
        <>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="issues-page-empty">No issues match the current filters.</td></tr>
                ) : filtered.map(issue => (
                  <IssueRow key={issue.id} issue={issue} onRefresh={handleRefresh} onOptimistic={applyOptimistic} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'resolved' && (
        <div className="issues-page-table-wrap" style={{ marginTop: 16 }}>
          {resolvedIssues.length === 0 ? (
            <p className="issues-page-empty" style={{ padding: 32, textAlign: 'center' }}>No resolved issues yet.</p>
          ) : (
            <table className="issues-page-table issues-resolved-table">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Workstream</th>
                  <th>Deliverable</th>
                  <th>Assigned</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {resolvedIssues.map(issue => (
                  <tr key={issue.id} className="resolved-issue-row">
                    <td className="issues-page-name">
                      {issue.url ? (
                        <a href={issue.url} target="_blank" rel="noopener noreferrer" className="issues-page-link" title="Open in Notion">
                          {issue.name || issue.description || '-'}
                          <span className="notion-icon">&#8599;</span>
                        </a>
                      ) : (issue.name || issue.description || '-')}
                    </td>
                    <td><span className={`sev-pill ${severityColor(issue.severity)}`}>{issue.severity || '-'}</span></td>
                    <td><span className="resolved-status-pill">{issue.status || '-'}</span></td>
                    <td>{issue.workstream || '-'}</td>
                    <td>{issue.deliverable || '-'}</td>
                    <td>{issue.assignedTo || '-'}</td>
                    <td>{formatDate(issue.dateCreated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
