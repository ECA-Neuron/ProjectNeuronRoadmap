import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function toIso(ts) { return new Date(ts).toISOString().slice(0, 10); }
function toTs(str) { return new Date(str).getTime(); }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
const DAY_MS = 86400000;

function generateTicks(rangeStart, rangeEnd, zoom) {
  const ticks = [];
  const d = new Date(rangeStart);
  if (zoom === 'day') {
    while (d.getTime() <= rangeEnd) {
      ticks.push({ ts: d.getTime(), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
      d.setDate(d.getDate() + 1);
    }
  } else if (zoom === 'week') {
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    while (d.getTime() <= rangeEnd) {
      ticks.push({ ts: d.getTime(), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
      d.setDate(d.getDate() + 7);
    }
  } else if (zoom === 'month') {
    d.setDate(1);
    while (d.getTime() <= rangeEnd) {
      ticks.push({ ts: d.getTime(), label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) });
      d.setMonth(d.getMonth() + 1);
    }
  } else {
    const qMonth = Math.floor(d.getMonth() / 3) * 3;
    d.setMonth(qMonth, 1);
    while (d.getTime() <= rangeEnd) {
      const q = Math.floor(d.getMonth() / 3) + 1;
      ticks.push({ ts: d.getTime(), label: `Q${q} ${d.getFullYear()}` });
      d.setMonth(d.getMonth() + 3);
    }
  }
  return ticks;
}

function flattenHierarchy(hierarchy, levelDates, expanded, dateOverrides) {
  const rows = [];
  const parentStack = [];

  const pushRow = (r) => {
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].depth >= r.depth)
      parentStack.pop();
    r.parentIdx = parentStack.length > 0 ? parentStack[parentStack.length - 1].idx : -1;
    r.idx = rows.length;
    const ov = r.notionId ? dateOverrides[r.notionId] : null;
    if (ov) { r.dateStarted = ov.start; r.dateExpectedComplete = ov.end; }
    rows.push(r);
    if (r.hasChildren && r.isExpanded) parentStack.push(r);
  };

  for (const ws of hierarchy) {
    const wsId = `ws|${ws.name}`;
    const wsDates = levelDates.workstream[ws.name] ?? {};
    const wsTasks = ws.tasks ?? [];
    const wsPct = ws.totalPoints > 0 ? ws.currentPoints / ws.totalPoints : 0;
    const wsEpics = ws.epics ?? [];
    pushRow({
      id: wsId, name: ws.name, level: 'workstream', depth: 0,
      dateStarted: wsDates.dateStarted, dateExpectedComplete: wsDates.dateExpectedComplete,
      pct: wsPct, totalPoints: ws.totalPoints,
      hasChildren: wsEpics.length > 0, isExpanded: !!expanded[wsId],
      isLastChild: false, taskData: null, notionId: ws.notionId ?? null,
      selectPayload: { type: 'workstream', key: `workstream|${ws.name}`, name: ws.name, tasks: wsTasks, url: ws.url },
    });
    if (!expanded[wsId]) continue;
    for (let ei = 0; ei < wsEpics.length; ei++) {
      const epic = wsEpics[ei];
      const epicId = `ep|${ws.name}|${epic.name}`;
      const epicDates = levelDates.epic[epic.name] ?? {};
      const epicTasks = epic.tasks ?? [];
      const epicPct = epic.totalPoints > 0 ? epic.currentPoints / epic.totalPoints : 0;
      const epicDels = epic.deliverables ?? [];
      pushRow({
        id: epicId, name: epic.name, level: 'epic', depth: 1,
        dateStarted: epicDates.dateStarted, dateExpectedComplete: epicDates.dateExpectedComplete,
        pct: epicPct, totalPoints: epic.totalPoints,
        hasChildren: epicDels.length > 0, isExpanded: !!expanded[epicId],
        isLastChild: ei === wsEpics.length - 1, taskData: null, notionId: epic.notionId ?? null,
        selectPayload: { type: 'epic', key: `epic|${ws.name}|${epic.name}`, name: epic.name, tasks: epicTasks, url: epic.url },
      });
      if (!expanded[epicId]) continue;
      for (let di = 0; di < epicDels.length; di++) {
        const del = epicDels[di];
        const delId = `del|${ws.name}|${epic.name}|${del.name}`;
        const delDates = levelDates.deliverable[del.name] ?? {};
        const delTasks = del.tasks ?? [];
        const delPct = del.totalPoints > 0 ? del.currentPoints / del.totalPoints : 0;
        pushRow({
          id: delId, name: del.name, level: 'deliverable', depth: 2,
          dateStarted: delDates.dateStarted, dateExpectedComplete: delDates.dateExpectedComplete,
          pct: delPct, totalPoints: del.totalPoints,
          hasChildren: delTasks.length > 0, isExpanded: !!expanded[delId],
          isLastChild: di === epicDels.length - 1, taskData: null, notionId: del.notionId ?? null,
          selectPayload: { type: 'deliverable', key: `deliverable|${ws.name}|${epic.name}|${del.name}`, name: del.name, tasks: delTasks, url: del.url },
        });
        if (!expanded[delId]) continue;
        for (let ti = 0; ti < delTasks.length; ti++) {
          const t = delTasks[ti];
          const tName = t.taskName ?? '';
          pushRow({
            id: `t|${ws.name}|${epic.name}|${del.name}|${tName}`,
            name: tName, level: 'task', depth: 3,
            dateStarted: t.dateStarted, dateExpectedComplete: t.dateExpectedComplete,
            pct: t.percentComplete ?? 0, totalPoints: t.totalPoints ?? 0,
            hasChildren: false, isExpanded: false,
            isLastChild: ti === delTasks.length - 1, taskData: t,
            notionId: t.taskId ?? null,
            selectPayload: { type: 'task', key: `${ws.name}|${epic.name}|${del.name}|${tName}`, name: tName, tasks: [t], url: t.url },
          });
        }
      }
    }
  }
  return rows;
}

function buildHierarchyLinks(rows, toLeft, ROW_H) {
  const links = [];
  const childrenOf = new Map();
  for (const r of rows) {
    if (r.parentIdx < 0) continue;
    if (!childrenOf.has(r.parentIdx)) childrenOf.set(r.parentIdx, []);
    childrenOf.get(r.parentIdx).push(r);
  }
  for (const [pIdx, children] of childrenOf) {
    const parent = rows[pIdx];
    if (!parent?.dateStarted || !parent?.dateExpectedComplete) continue;
    const pLeftPct = toLeft(toTs(parent.dateStarted));
    const pBottomY = ROW_H + pIdx * ROW_H + ROW_H;
    const lastChild = children[children.length - 1];
    const lastCY = ROW_H + lastChild.idx * ROW_H + ROW_H / 2;
    links.push({ type: 'vert', xPct: pLeftPct, yTop: pBottomY, yBot: lastCY });
    for (const child of children) {
      const cLeftPct = (child.dateStarted && child.dateExpectedComplete) ? toLeft(toTs(child.dateStarted)) : pLeftPct;
      const cY = ROW_H + child.idx * ROW_H + ROW_H / 2;
      links.push({ type: 'horiz', xPct: pLeftPct, xEndPct: cLeftPct, y: cY });
    }
  }
  return links;
}

function buildDepLinks(rows, toLeft, ROW_H) {
  const links = [];
  const taskIdToRowIdx = new Map();
  rows.forEach((r, i) => { if (r.taskData?.taskId) taskIdToRowIdx.set(r.taskData.taskId, i); });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.taskData?.blocking?.length) continue;
    const fromEnd = r.dateExpectedComplete ? toLeft(toTs(r.dateExpectedComplete)) : null;
    if (fromEnd == null) continue;
    const fromY = ROW_H + i * ROW_H + ROW_H / 2;
    for (const dep of r.taskData.blocking) {
      const targetIdx = taskIdToRowIdx.get(dep.id);
      if (targetIdx == null) continue;
      const target = rows[targetIdx];
      const toStart = target.dateStarted ? toLeft(toTs(target.dateStarted)) : null;
      if (toStart == null) continue;
      const toY = ROW_H + targetIdx * ROW_H + ROW_H / 2;
      links.push({ fromPct: fromEnd, toPct: toStart, fromY, toY, fromName: r.name, toName: target.name });
    }
  }
  return links;
}

async function saveDates(notionId, start, end) {
  const resp = await fetch(`/api/item/${notionId}/dates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start, end }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save dates');
  }
}

const INDENT = 20;

export default function TimelineView({ data, onSelect, onRefresh }) {
  const hierarchy = data?.hierarchy ?? [];
  const levelDates = useMemo(() => ({
    deliverable: data?.deliverableDates ?? {},
    epic: data?.epicDates ?? {},
    workstream: data?.workstreamDates ?? {},
  }), [data]);

  const [expanded, setExpanded] = useState({});
  const [zoom, setZoom] = useState('month');
  const [showDeps, setShowDeps] = useState(true);
  const [locked, setLocked] = useState(true);
  const [dateOverrides, setDateOverrides] = useState({});
  const [toast, setToast] = useState(null);
  const [datePicker, setDatePicker] = useState(null);
  const chartRef = useRef(null);
  const labelsRef = useRef(null);
  const syncing = useRef(false);
  const dragRef = useRef(null);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const toggle = (id) => setExpanded(s => ({ ...s, [id]: !s[id] }));

  const syncScroll = useCallback((source) => {
    if (syncing.current) return;
    syncing.current = true;
    const lp = labelsRef.current, cp = chartRef.current;
    if (lp && cp) {
      if (source === 'chart') lp.scrollTop = cp.scrollTop;
      else cp.scrollTop = lp.scrollTop;
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  const rows = useMemo(
    () => flattenHierarchy(hierarchy, levelDates, expanded, dateOverrides),
    [hierarchy, levelDates, expanded, dateOverrides]
  );

  const { rangeStart, rangeEnd } = useMemo(() => {
    let min = Infinity, max = -Infinity;
    const check = (ds, de) => {
      if (ds) min = Math.min(min, toTs(ds));
      if (de) max = Math.max(max, toTs(de));
    };
    for (const ws of hierarchy) {
      const wd = levelDates.workstream[ws.name] ?? {};
      check(wd.dateStarted, wd.dateExpectedComplete);
      for (const ep of (ws.epics ?? [])) {
        const ed = levelDates.epic[ep.name] ?? {};
        check(ed.dateStarted, ed.dateExpectedComplete);
        for (const dl of (ep.deliverables ?? [])) {
          const dd = levelDates.deliverable[dl.name] ?? {};
          check(dd.dateStarted, dd.dateExpectedComplete);
          for (const t of (dl.tasks ?? [])) { check(t.dateStarted, t.dateExpectedComplete); }
        }
      }
    }
    if (!isFinite(min)) { const now = Date.now(); min = now - 30 * DAY_MS; max = now + 180 * DAY_MS; }
    const pad = (max - min) * 0.02;
    return { rangeStart: min - pad, rangeEnd: max + pad };
  }, [hierarchy, levelDates]);

  const rangeDuration = rangeEnd - rangeStart;
  const toLeftPct = useCallback((ts) => ((ts - rangeStart) / rangeDuration) * 100, [rangeStart, rangeDuration]);
  const pctToTs = useCallback((pct) => rangeStart + (pct / 100) * rangeDuration, [rangeStart, rangeDuration]);

  const ticks = useMemo(() => generateTicks(rangeStart, rangeEnd, zoom), [rangeStart, rangeEnd, zoom]);
  const todayLeft = toLeftPct(Date.now());

  const minChartWidth = zoom === 'day' ? daysBetween(rangeStart, rangeEnd) * 28
    : zoom === 'week' ? daysBetween(rangeStart, rangeEnd) * 6
    : zoom === 'month' ? Math.max(900, daysBetween(rangeStart, rangeEnd) * 3)
    : 900;

  const ROW_H = 38;

  const hierarchyLinks = useMemo(() => buildHierarchyLinks(rows, toLeftPct, ROW_H), [rows, toLeftPct]);
  const depLinks = useMemo(() => showDeps ? buildDepLinks(rows, toLeftPct, ROW_H) : [], [rows, toLeftPct, showDeps]);

  useEffect(() => {
    if (chartRef.current && todayLeft > 10 && todayLeft < 90) {
      const el = chartRef.current;
      requestAnimationFrame(() => {
        const targetX = (todayLeft / 100) * el.scrollWidth - el.clientWidth / 2;
        el.scrollLeft = Math.max(0, targetX);
      });
    }
  }, [rows.length]);

  const chartHeight = ROW_H * rows.length + ROW_H;

  const commitDates = useCallback(async (notionId, start, end) => {
    if (!notionId) { showToast('No Notion ID — cannot save', 'error'); return; }
    setDateOverrides(prev => ({ ...prev, [notionId]: { start, end } }));
    try {
      await saveDates(notionId, start, end);
      showToast('Dates saved');
      if (onRefresh) onRefresh();
    } catch (err) {
      showToast(err.message, 'error');
      setDateOverrides(prev => { const n = { ...prev }; delete n[notionId]; return n; });
    }
  }, [onRefresh]);

  const pxToPctDelta = useCallback((pxDelta) => {
    const chartEl = chartRef.current;
    if (!chartEl) return 0;
    return (pxDelta / chartEl.scrollWidth) * 100;
  }, []);

  const onBarMouseDown = useCallback((e, r, mode) => {
    if (locked || !r.notionId) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = r.dateStarted;
    const origEnd = r.dateExpectedComplete;
    const nid = r.notionId;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dPct = pxToPctDelta(dx);
      const dTs = (dPct / 100) * rangeDuration;
      const dDays = Math.round(dTs / DAY_MS);
      if (dDays === 0 && dragRef.current?.lastDays === 0) return;

      let newStart, newEnd;
      if (mode === 'move') {
        newStart = toIso(toTs(origStart) + dDays * DAY_MS);
        newEnd = toIso(toTs(origEnd) + dDays * DAY_MS);
      } else if (mode === 'resize-left') {
        newStart = toIso(toTs(origStart) + dDays * DAY_MS);
        newEnd = origEnd;
        if (toTs(newStart) >= toTs(newEnd)) newStart = toIso(toTs(newEnd) - DAY_MS);
      } else {
        newStart = origStart;
        newEnd = toIso(toTs(origEnd) + dDays * DAY_MS);
        if (toTs(newEnd) <= toTs(newStart)) newEnd = toIso(toTs(newStart) + DAY_MS);
      }
      dragRef.current = { lastDays: dDays, nid, newStart, newEnd };
      setDateOverrides(prev => ({ ...prev, [nid]: { start: newStart, end: newEnd } }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.classList.remove('tl-dragging');
      const d = dragRef.current;
      dragRef.current = null;
      if (d && (d.newStart !== origStart || d.newEnd !== origEnd)) {
        commitDates(nid, d.newStart, d.newEnd);
      } else {
        setDateOverrides(prev => { const n = { ...prev }; delete n[nid]; return n; });
      }
    };

    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'col-resize';
    document.body.classList.add('tl-dragging');
    dragRef.current = { lastDays: 0, nid, newStart: origStart, newEnd: origEnd };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [locked, pxToPctDelta, rangeDuration, commitDates]);

  const onRowClickToAdd = useCallback((e, r) => {
    if (!r.notionId) { showToast('No Notion ID for this item', 'error'); return; }
    const chartEl = chartRef.current;
    if (!chartEl) return;
    const rect = chartEl.getBoundingClientRect();
    const xInChart = e.clientX - rect.left + chartEl.scrollLeft;
    const pct = (xInChart / chartEl.scrollWidth) * 100;
    const clickTs = pctToTs(pct);
    const start = toIso(clickTs);
    const end = toIso(clickTs + 14 * DAY_MS);
    setDatePicker({ rowId: r.id, notionId: r.notionId, start, end, rowIdx: r.idx });
  }, [pctToTs]);

  const submitDatePicker = useCallback(() => {
    if (!datePicker) return;
    const { notionId, start, end } = datePicker;
    if (!start) { showToast('Start date is required', 'error'); return; }
    commitDates(notionId, start, end || null);
    setDatePicker(null);
  }, [datePicker, commitDates]);

  return (
    <div className="tl-container">
      <div className="tl-toolbar">
        <h2 className="tl-title">Timeline</h2>
        <div className="tl-toolbar-right">
          <button
            className={`tl-lock-btn${locked ? ' locked' : ' unlocked'}`}
            onClick={() => setLocked(l => !l)}
            title={locked ? 'Unlock to edit dates' : 'Lock to prevent accidental edits'}
          >
            {locked ? '\u{1F512}' : '\u{1F513}'} {locked ? 'Locked' : 'Unlocked'}
          </button>
          <label className="tl-dep-toggle">
            <input type="checkbox" checked={showDeps} onChange={e => setShowDeps(e.target.checked)} />
            <span>Dependencies</span>
          </label>
          <div className="tl-zoom">
            {['day', 'week', 'month', 'quarter'].map(z => (
              <button key={z} className={`tl-zoom-btn${zoom === z ? ' active' : ''}`} onClick={() => setZoom(z)}>
                {z.charAt(0).toUpperCase() + z.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {toast && <div className={`tl-toast tl-toast-${toast.type}`}>{toast.msg}</div>}
      {datePicker && (
        <div className="tl-datepicker-overlay" onClick={() => setDatePicker(null)}>
          <div className="tl-datepicker" onClick={e => e.stopPropagation()}>
            <h4>Set Dates</h4>
            <label>
              Start
              <input type="date" value={datePicker.start || ''} onChange={e => setDatePicker(p => ({ ...p, start: e.target.value }))} />
            </label>
            <label>
              End
              <input type="date" value={datePicker.end || ''} onChange={e => setDatePicker(p => ({ ...p, end: e.target.value }))} />
            </label>
            <div className="tl-datepicker-actions">
              <button className="tl-datepicker-save" onClick={submitDatePicker}>Save</button>
              <button className="tl-datepicker-cancel" onClick={() => setDatePicker(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="tl-body">
        <div className="tl-labels" ref={labelsRef} onScroll={() => syncScroll('labels')}>
          <div className="tl-labels-header">Name</div>
          {rows.map(r => (
            <div key={r.id} className={`tl-label tl-level-${r.level}`} style={{ height: ROW_H, paddingLeft: 8 + r.depth * INDENT }}>
              {r.hasChildren ? (
                <button className="tl-expand-btn" onClick={() => toggle(r.id)}>{r.isExpanded ? '\u25BE' : '\u25B8'}</button>
              ) : <span className="tl-leaf-dot">&bull;</span>}
              <button
                className="tl-label-name"
                onClick={() => r.hasChildren && toggle(r.id)}
                onDoubleClick={() => onSelect?.(r.selectPayload)}
                title={r.name}
              >{r.name}</button>
            </div>
          ))}
        </div>
        <div className="tl-chart-scroll" ref={chartRef} onScroll={() => syncScroll('chart')}>
          <div className="tl-chart" style={{ minWidth: minChartWidth, height: chartHeight }}>
            <div className="tl-axis" style={{ height: ROW_H }}>
              {ticks.map((t, i) => (
                <div key={i} className="tl-tick" style={{ left: `${toLeftPct(t.ts)}%` }}>
                  <span className="tl-tick-label">{t.label}</span>
                </div>
              ))}
            </div>
            {todayLeft >= 0 && todayLeft <= 100 && (
              <div className="tl-today" style={{ left: `${todayLeft}%`, height: chartHeight }} />
            )}
            {rows.map(r => {
              const hasRange = r.dateStarted && r.dateExpectedComplete;
              const barLeft = hasRange ? toLeftPct(toTs(r.dateStarted)) : 0;
              const barWidth = hasRange ? toLeftPct(toTs(r.dateExpectedComplete)) - barLeft : 0;
              const isDragging = dragRef.current?.nid === r.notionId;
              return (
                <div key={r.id} className="tl-row" style={{ height: ROW_H }}>
                  {ticks.map((t, i) => (
                    <div key={i} className="tl-gridline" style={{ left: `${toLeftPct(t.ts)}%` }} />
                  ))}
                  {hasRange ? (
                    <div
                      className={`tl-bar tl-bar-${r.level}${isDragging ? ' tl-bar-dragging' : ''}${!locked && r.notionId ? ' tl-bar-editable' : ''}`}
                      style={{ left: `${barLeft}%`, width: `${Math.max(barWidth, 0.3)}%` }}
                      title={`${r.name}\n${formatDate(r.dateStarted)} – ${formatDate(r.dateExpectedComplete)}\n${Math.round(r.pct * 100)}% complete${!locked && r.notionId ? '\nDrag to move · Drag edges to resize' : ''}`}
                    >
                      {!locked && r.notionId && (
                        <div className="tl-handle tl-handle-left" onMouseDown={e => onBarMouseDown(e, r, 'resize-left')} />
                      )}
                      <div
                        className="tl-bar-fill"
                        style={{ width: `${Math.round(r.pct * 100)}%` }}
                      />
                      <div
                        className="tl-bar-body"
                        onMouseDown={!locked && r.notionId ? (e => onBarMouseDown(e, r, 'move')) : undefined}
                        onClick={() => r.hasChildren && toggle(r.id)}
                        onDoubleClick={() => onSelect?.(r.selectPayload)}
                      >
                        <span className="tl-bar-text">{r.name}</span>
                      </div>
                      {!locked && r.notionId && (
                        <div className="tl-handle tl-handle-right" onMouseDown={e => onBarMouseDown(e, r, 'resize-right')} />
                      )}
                    </div>
                  ) : (
                    <button
                      className="tl-add-dates"
                      onClick={e => !locked ? onRowClickToAdd(e, r) : (r.hasChildren && toggle(r.id))}
                      onDoubleClick={() => onSelect?.(r.selectPayload)}
                      title={!locked ? 'Click to set dates' : r.name}
                    >
                      {!locked ? '+ Set dates' : 'No dates'}
                    </button>
                  )}
                </div>
              );
            })}
            <svg className="tl-svg-overlay" style={{ width: '100%', height: chartHeight }}>
              <defs>
                <marker id="tl-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L8,3 L0,6 Z" fill="var(--amber, #f59e0b)" />
                </marker>
              </defs>
              {hierarchyLinks.map((link, i) =>
                link.type === 'vert' ? (
                  <line key={`hv-${i}`} x1={`${link.xPct}%`} y1={link.yTop} x2={`${link.xPct}%`} y2={link.yBot} className="tl-hier-line" />
                ) : (
                  <line key={`hh-${i}`} x1={`${link.xPct}%`} y1={link.y} x2={`${link.xEndPct}%`} y2={link.y} className="tl-hier-line" />
                )
              )}
              {depLinks.map((link, i) => {
                const midPct = (link.fromPct + link.toPct) / 2;
                return (
                  <g key={`d-${i}`}>
                    <path
                      d={`M ${link.fromPct}% ${link.fromY} C ${midPct}% ${link.fromY}, ${midPct}% ${link.toY}, ${link.toPct}% ${link.toY}`}
                      className="tl-dep-line" markerEnd="url(#tl-arrow)"
                    />
                    <title>{link.fromName} blocks {link.toName}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
