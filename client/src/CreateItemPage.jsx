import React, { useState, useMemo, useCallback } from 'react';

const LEVELS = ['Workstream', 'Epic', 'Deliverable', 'Task'];
const RISK_OPTIONS = ['', 'Low', 'Medium', 'High', 'Critical'];
const SCOPE_OPTIONS = ['', 'Original', 'Added'];
const STATUS_OPTIONS = ['', 'Not started', 'In progress', 'Done'];

const emptyForm = {
  name: '',
  level: '',
  workstream: '',
  epic: '',
  deliverable: '',
  startDate: '',
  endDate: '',
  estimatedDays: '',
  levelOfRisk: '',
  typeOfScope: 'Original',
  status: 'Not started',
  text: '',
};

export default function CreateItemPage({ hierarchy, onRefresh }) {
  const [form, setForm] = useState({ ...emptyForm });
  const [submitState, setSubmitState] = useState(null);

  const set = useCallback((field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'level') {
        next.workstream = '';
        next.epic = '';
        next.deliverable = '';
      }
      if (field === 'workstream') {
        next.epic = '';
        next.deliverable = '';
      }
      if (field === 'epic') {
        next.deliverable = '';
      }
      return next;
    });
  }, []);

  const workstreams = useMemo(() =>
    (hierarchy ?? []).map(ws => ({ name: ws.name, id: ws.notionId })).filter(w => w.id),
  [hierarchy]);

  const epics = useMemo(() => {
    if (!form.workstream) return [];
    const ws = (hierarchy ?? []).find(w => w.notionId === form.workstream);
    return (ws?.epics ?? []).map(e => ({ name: e.name, id: e.notionId })).filter(e => e.id);
  }, [hierarchy, form.workstream]);

  const deliverables = useMemo(() => {
    if (!form.workstream || !form.epic) return [];
    const ws = (hierarchy ?? []).find(w => w.notionId === form.workstream);
    const ep = (ws?.epics ?? []).find(e => e.notionId === form.epic);
    return (ep?.deliverables ?? []).map(d => ({ name: d.name, id: d.notionId })).filter(d => d.id);
  }, [hierarchy, form.workstream, form.epic]);

  const parentId = useMemo(() => {
    if (form.level === 'Workstream') return null;
    if (form.level === 'Epic') return form.workstream || null;
    if (form.level === 'Deliverable') return form.epic || null;
    if (form.level === 'Task') return form.deliverable || null;
    return null;
  }, [form.level, form.workstream, form.epic, form.deliverable]);

  const canSubmit = form.name && form.level && (form.level === 'Workstream' || parentId);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitState({ type: 'loading', msg: 'Creating item...' });
    try {
      const body = {
        name: form.name,
        level: form.level,
        parentId,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        estimatedDays: form.estimatedDays ? Number(form.estimatedDays) : null,
        levelOfRisk: form.levelOfRisk || null,
        typeOfScope: form.typeOfScope || null,
        status: form.status || null,
        text: form.text || null,
      };
      const resp = await fetch('/api/item/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create item');
      }
      const data = await resp.json();
      setSubmitState({ type: 'success', msg: 'Created successfully!', url: data.url });
      setForm({ ...emptyForm });
      setTimeout(() => {
        if (onRefresh) onRefresh();
        setSubmitState(null);
      }, 2500);
    } catch (err) {
      setSubmitState({ type: 'error', msg: err.message });
    }
  }, [canSubmit, form, parentId, onRefresh]);

  const needsWorkstream = form.level === 'Epic' || form.level === 'Deliverable' || form.level === 'Task';
  const needsEpic = form.level === 'Deliverable' || form.level === 'Task';
  const needsDeliverable = form.level === 'Task';

  return (
    <div className="create-page">
      <h2 className="create-page-title">Create New Item</h2>

      <div className="create-card">
        <div className="create-section">
          <label className="create-label">Item Type</label>
          <div className="create-level-btns">
            {LEVELS.map(lv => (
              <button key={lv} className={`create-level-btn${form.level === lv ? ' active' : ''}`} onClick={() => set('level', lv)}>
                {lv}
              </button>
            ))}
          </div>
        </div>

        {needsWorkstream && (
          <div className="create-section">
            <label className="create-label">Parent Workstream</label>
            <select className="create-select" value={form.workstream} onChange={e => set('workstream', e.target.value)}>
              <option value="">Select workstream...</option>
              {workstreams.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}

        {needsEpic && form.workstream && (
          <div className="create-section">
            <label className="create-label">Parent Epic</label>
            <select className="create-select" value={form.epic} onChange={e => set('epic', e.target.value)}>
              <option value="">Select epic...</option>
              {epics.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        )}

        {needsDeliverable && form.epic && (
          <div className="create-section">
            <label className="create-label">Parent Deliverable</label>
            <select className="create-select" value={form.deliverable} onChange={e => set('deliverable', e.target.value)}>
              <option value="">Select deliverable...</option>
              {deliverables.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        <hr className="create-divider" />

        <div className="create-section">
          <label className="create-label">Name <span className="create-req">*</span></label>
          <input className="create-input" type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Item name" />
        </div>

        <div className="create-row">
          <div className="create-section create-half">
            <label className="create-label">Start Date</label>
            <input className="create-input" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div className="create-section create-half">
            <label className="create-label">End Date</label>
            <input className="create-input" type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
          </div>
        </div>

        <div className="create-section">
          <label className="create-label">Estimated Days</label>
          <input className="create-input" type="number" min="0" value={form.estimatedDays} onChange={e => set('estimatedDays', e.target.value)} placeholder="0" />
        </div>

        <div className="create-row">
          <div className="create-section create-third">
            <label className="create-label">Risk</label>
            <select className="create-select" value={form.levelOfRisk} onChange={e => set('levelOfRisk', e.target.value)}>
              {RISK_OPTIONS.map(o => <option key={o} value={o}>{o || 'None'}</option>)}
            </select>
          </div>
          <div className="create-section create-third">
            <label className="create-label">Scope</label>
            <select className="create-select" value={form.typeOfScope} onChange={e => set('typeOfScope', e.target.value)}>
              {SCOPE_OPTIONS.map(o => <option key={o} value={o}>{o || 'None'}</option>)}
            </select>
          </div>
          <div className="create-section create-third">
            <label className="create-label">Status</label>
            <select className="create-select" value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o || 'None'}</option>)}
            </select>
          </div>
        </div>

        <div className="create-section">
          <label className="create-label">Notes / Description</label>
          <textarea className="create-textarea" rows={3} value={form.text} onChange={e => set('text', e.target.value)} placeholder="Optional notes..." />
        </div>

        <div className="create-actions">
          {submitState?.type === 'success' && (
            <span className="create-status create-success">{submitState.msg}{' '}
              {submitState.url && <a href={submitState.url} target="_blank" rel="noopener noreferrer">Open in Notion &#8599;</a>}
            </span>
          )}
          {submitState?.type === 'error' && <span className="create-status create-error">{submitState.msg}</span>}
          {submitState?.type === 'loading' && <span className="create-status create-loading">{submitState.msg}</span>}
          <button className="create-submit" disabled={!canSubmit || submitState?.type === 'loading'} onClick={handleSubmit}>
            {submitState?.type === 'loading' ? 'Creating...' : `Create ${form.level || 'Item'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
