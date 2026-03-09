import React, { useState, useMemo, useCallback } from 'react';

const SEVERITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'];

const empty = {
  name: '', description: '', severity: 'Medium',
  assignedTo: '', workstream: '', epic: '', deliverable: '', task: '',
};

export default function NewIssueModal({ hierarchy, roadmapRows, onClose, onRefresh, onOptimisticCreate }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(null);

  const set = useCallback((k, v) => {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      if (k === 'workstream') { next.epic = ''; next.deliverable = ''; next.task = ''; }
      if (k === 'epic') { next.deliverable = ''; next.task = ''; }
      if (k === 'deliverable') { next.task = ''; }
      return next;
    });
  }, []);

  const people = useMemo(() => {
    const names = new Set();
    for (const row of (roadmapRows ?? [])) {
      const a = (row.assignee ?? '').trim();
      if (a && a !== 'Unassigned' && a !== 'Unknown') {
        a.split(',').forEach(n => { const t = n.trim(); if (t) names.add(t); });
      }
    }
    for (const iss of (hierarchy ?? []).flatMap(ws => ws.epics ?? []).flatMap(ep => [...(ep.deliverables ?? [])].flatMap(d => d.tasks ?? []))) {
      const a = (iss.assignee ?? '').trim();
      if (a && a !== 'Unassigned' && a !== 'Unknown') {
        a.split(',').forEach(n => { const t = n.trim(); if (t) names.add(t); });
      }
    }
    return [...names].sort();
  }, [roadmapRows, hierarchy]);

  const workstreams = useMemo(() =>
    (hierarchy ?? []).map(ws => ws.name).filter(Boolean).sort(),
  [hierarchy]);

  const epics = useMemo(() => {
    if (!form.workstream) return [];
    const ws = (hierarchy ?? []).find(w => w.name === form.workstream);
    return (ws?.epics ?? []).map(e => e.name).filter(Boolean).sort();
  }, [hierarchy, form.workstream]);

  const deliverables = useMemo(() => {
    if (!form.workstream || !form.epic) return [];
    const ws = (hierarchy ?? []).find(w => w.name === form.workstream);
    const ep = (ws?.epics ?? []).find(e => e.name === form.epic);
    return (ep?.deliverables ?? []).map(d => d.name).filter(Boolean).sort();
  }, [hierarchy, form.workstream, form.epic]);

  const tasks = useMemo(() => {
    if (!form.workstream) return [];
    const ws = (hierarchy ?? []).find(w => w.name === form.workstream);
    const allTasks = [];
    for (const ep of (ws?.epics ?? [])) {
      if (form.epic && ep.name !== form.epic) continue;
      for (const del of (ep?.deliverables ?? [])) {
        if (form.deliverable && del.name !== form.deliverable) continue;
        for (const t of (del?.tasks ?? [])) {
          if (t.taskName) allTasks.push({ name: t.taskName, id: t.taskId });
        }
      }
    }
    return allTasks.sort((a, b) => a.name.localeCompare(b.name));
  }, [hierarchy, form.workstream, form.epic, form.deliverable]);

  const canSubmit = form.name.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSaving('saving');

    const selectedTask = tasks.find(t => t.name === form.task);
    const optimistic = {
      id: '_opt_' + Date.now(),
      name: form.name.trim(),
      description: form.description.trim() || '',
      status: 'Open',
      severity: form.severity || '',
      assignedTo: form.assignedTo || '',
      workstream: form.workstream || '',
      epic: form.epic || '',
      deliverable: form.deliverable || '',
      relatedTaskName: form.task || '',
      relatedTaskId: selectedTask?.id || null,
      dateCreated: new Date().toISOString().slice(0, 10),
      comments: [],
      _optimistic: true,
    };
    if (onOptimisticCreate) onOptimisticCreate(optimistic);

    try {
      const body = {
        name: optimistic.name,
        description: optimistic.description || null,
        status: 'Open',
        severity: optimistic.severity || null,
        assignedTo: optimistic.assignedTo || null,
        relatedTaskId: selectedTask?.id || null,
        deliverable: form.deliverable || null,
        epic: form.epic || null,
      };
      const resp = await fetch('/api/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to create issue');
      }
      setSaving('saved');
      setTimeout(() => {
        onClose();
        if (onRefresh) onRefresh();
      }, 1200);
    } catch (err) {
      setSaving('error:' + err.message);
    }
  }, [canSubmit, form, tasks, onClose, onRefresh, onOptimisticCreate]);

  return (
    <div className="new-issue-overlay" onClick={onClose}>
      <div className="new-issue-modal" onClick={e => e.stopPropagation()}>
        <div className="new-issue-header">
          <h3>New Open Issue</h3>
          <button type="button" className="new-issue-close" onClick={onClose}>&times;</button>
        </div>

        <div className="new-issue-body">
          <div className="new-issue-field">
            <label>Issue Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Describe the issue" autoFocus />
          </div>

          <div className="new-issue-field">
            <label>Description</label>
            <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Additional details..." />
          </div>

          <div className="new-issue-field">
            <label>Severity</label>
            <select value={form.severity} onChange={e => set('severity', e.target.value)}>
              {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="new-issue-field">
            <label>Assigned To</label>
            <select value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)}>
              <option value="">-</option>
              {people.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="new-issue-divider" />

          <div className="new-issue-row">
            <div className="new-issue-field">
              <label>Workstream</label>
              <select value={form.workstream} onChange={e => set('workstream', e.target.value)}>
                <option value="">-</option>
                {workstreams.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="new-issue-field">
              <label>Epic</label>
              <select value={form.epic} onChange={e => set('epic', e.target.value)} disabled={!form.workstream}>
                <option value="">-</option>
                {epics.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          </div>

          <div className="new-issue-row">
            <div className="new-issue-field">
              <label>Deliverable</label>
              <select value={form.deliverable} onChange={e => set('deliverable', e.target.value)} disabled={!form.epic}>
                <option value="">-</option>
                {deliverables.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="new-issue-field">
              <label>Related Task</label>
              <select value={form.task} onChange={e => set('task', e.target.value)} disabled={!form.workstream}>
                <option value="">-</option>
                {tasks.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="new-issue-footer">
          {saving === 'saving' && <span className="issue-edit-status issue-edit-saving">Creating...</span>}
          {saving === 'saved' && <span className="issue-edit-status issue-edit-saved">Created!</span>}
          {saving?.startsWith('error:') && <span className="issue-edit-status issue-edit-error">{saving.slice(6)}</span>}
          <button type="button" className="new-issue-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="new-issue-submit" onClick={handleSubmit} disabled={!canSubmit || saving === 'saving'}>
            Create Issue
          </button>
        </div>
      </div>
    </div>
  );
}
