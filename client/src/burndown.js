/**
 * Burndown computation with bi-weekly X-axis.
 * totalPoints from Neuron Workstreams, currentPoints from Progress Log.
 * remainingPoints = totalPoints - currentPoints.
 * Actual line always starts at totalPoints (same as ideal) at the start date.
 * Points only at task level; higher levels = sum of child tasks.
 */

function taskKey(row) {
  const w = row.Workstream ?? '';
  const e = row.Epic ?? '';
  const d = row.Deliverable ?? '';
  const t = row.taskName ?? '';
  return `${w}|${e}|${d}|${t}`;
}

function mondayOf(d) {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function snapToWeek(dateStr, weeklyTicks) {
  if (!weeklyTicks || weeklyTicks.length === 0) return dateStr;
  let best = weeklyTicks[0];
  let bestDist = Math.abs(new Date(dateStr) - new Date(best));
  for (const tick of weeklyTicks) {
    const dist = Math.abs(new Date(dateStr) - new Date(tick));
    if (dist < bestDist) { best = tick; bestDist = dist; }
  }
  return best;
}

function generateWeeklyDates(startStr, endStr) {
  if (!startStr || !endStr) return [];
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
  const dates = [];
  const current = mondayOf(start);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 7);
  }
  return dates;
}

export function buildTaskSeriesFromMerged(roadmapRows) {
  const byKey = new Map();
  for (const row of roadmapRows) {
    const k = taskKey(row);
    if (!byKey.has(k)) byKey.set(k, { task: row, progressRows: row.progressRows ?? [] });
  }

  const out = {};
  for (const [key, { task, progressRows }] of byKey) {
    const totalPoints = task.totalPoints ?? 0;
    const start = task.dateStarted ?? null;
    const end = task.dateExpectedComplete ?? null;
    const biweeklyDates = generateWeeklyDates(start, end);
    const pctComplete = task.percentComplete ?? (totalPoints > 0 ? (task.currentPoints ?? 0) / totalPoints : 0);
    const currentPoints = pctComplete * totalPoints;
    const isAddedScope = (task.typeOfScope ?? '').toLowerCase().includes('added');

    const sortedProgress = [...progressRows].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const progressData = sortedProgress.map(r => ({
      date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
      points: Math.max(0, totalPoints * (1 - (r.percentComplete ?? 0))),
      updates: [{
        taskName: task.taskName,
        userName: r.userName ?? '',
        comment: r.comment ?? '',
        pct: r.percentComplete ?? 0,
        prevPct: r.prevPercentComplete ?? 0,
      }],
    })).filter(d => d.date);

    const actualMap = new Map();
    if (start && totalPoints > 0) {
      actualMap.set(start, { date: start, points: totalPoints, updates: [] });
    }
    for (const pt of progressData) {
      let effectiveDate = pt.date;
      let early = false;
      if (start && pt.date < start) {
        early = true;
        const nextDay = new Date(start + 'T12:00:00Z');
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        effectiveDate = nextDay.toISOString().slice(0, 10);
      }
      const updates = early
        ? pt.updates.map(u => ({ ...u, earlyProgress: true }))
        : pt.updates;
      const originalDate = early ? pt.date : null;
      const existing = actualMap.get(effectiveDate);
      if (existing) {
        existing.points = pt.points;
        if (updates?.length) existing.updates = [...(existing.updates ?? []), ...updates];
        if (early) { existing.earlyProgress = true; existing.originalDate = originalDate; }
      } else {
        actualMap.set(effectiveDate, { ...pt, date: effectiveDate, updates, earlyProgress: early, originalDate });
      }
    }
    const actualData = [...actualMap.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const originalPoints = isAddedScope ? 0 : totalPoints;
    out[key] = {
      totalPoints,
      originalPoints,
      isAddedScope,
      currentPoints,
      pctComplete,
      dateStarted: start,
      dateExpectedComplete: end,
      biweeklyDates,
      actualData,
      idealLine: start && end ? [{ date: start, points: totalPoints }, { date: end, points: 0 }] : [],
    };
  }
  return out;
}

export function rollupBurndown(taskSeries, hierarchyNode, dateOverride) {
  const tasks = hierarchyNode.tasks ?? [];
  if (tasks.length === 0) return { totalPoints: 0, originalPoints: 0, currentPoints: 0, pctComplete: 0, actualData: [], idealLine: [], originalIdealLine: [], dateStarted: null, dateExpectedComplete: null, biweeklyDates: [] };

  const keys = [...new Set(tasks.map(t => taskKey(t)))];
  const seriesList = keys.map(k => taskSeries[k]).filter(Boolean);
  if (seriesList.length === 0) return { totalPoints: 0, originalPoints: 0, currentPoints: 0, pctComplete: 0, actualData: [], idealLine: [], originalIdealLine: [], dateStarted: null, dateExpectedComplete: null, biweeklyDates: [] };

  const totalPoints = seriesList.reduce((s, x) => s + (x.totalPoints ?? 0), 0);
  const originalPoints = seriesList.reduce((s, x) => s + (x.originalPoints ?? x.totalPoints ?? 0), 0);
  const currentPoints = seriesList.reduce((s, x) => s + (x.currentPoints ?? 0), 0);
  const pctComplete = totalPoints > 0 ? currentPoints / totalPoints : 0;

  const dateStarted = dateOverride?.dateStarted
    ?? seriesList.map(s => s.dateStarted).filter(Boolean).sort()[0]
    ?? null;
  const dateExpectedComplete = dateOverride?.dateExpectedComplete
    ?? seriesList.map(s => s.dateExpectedComplete).filter(Boolean).sort().pop()
    ?? null;

  const biweeklyDates = generateWeeklyDates(dateStarted, dateExpectedComplete);

  const today = new Date().toISOString().slice(0, 10);
  const dateSet = new Set();
  seriesList.forEach(s => (s.actualData ?? []).forEach(d => {
    const effectiveDate = d.originalDate ?? d.date;
    if (effectiveDate <= today) dateSet.add(effectiveDate);
  }));
  if (dateStarted) dateSet.add(dateStarted);
  const sortedDates = [...dateSet].sort();

  const rawActual = sortedDates.map(date => {
    let points = 0;
    const updates = [];
    for (const s of seriesList) {
      const arr = s.actualData ?? [];
      const last = arr.filter(d => (d.originalDate ?? d.date) <= date).pop();
      if (last) {
        points += last.points;
        const matchDate = last.originalDate ?? last.date;
        if (matchDate === date && last.updates?.length > 0) {
          updates.push(...last.updates);
        }
      }
      else points += s.totalPoints;
    }
    return { date, points, updates };
  });

  const actualData = [];
  if (dateStarted) {
    actualData.push({ date: dateStarted, points: totalPoints, updates: [] });
  }
  for (const pt of rawActual) {
    if (pt.date === dateStarted && pt.points === totalPoints) continue;
    actualData.push(pt);
  }
  const idealLine = dateStarted && dateExpectedComplete
    ? [{ date: dateStarted, points: totalPoints }, { date: dateExpectedComplete, points: 0 }]
    : [];
  const originalIdealLine = dateStarted && dateExpectedComplete && originalPoints !== totalPoints
    ? [{ date: dateStarted, points: originalPoints }, { date: dateExpectedComplete, points: 0 }]
    : [];

  return { totalPoints, originalPoints, currentPoints, pctComplete, actualData, idealLine, originalIdealLine, dateStarted, dateExpectedComplete, biweeklyDates };
}

export function isSeriesOffTrack(series) {
  if (!series || !series.dateStarted || !series.dateExpectedComplete) return false;
  const actual = series.actualData ?? [];
  if (actual.length < 2) return false;
  const lastActual = actual[actual.length - 1];
  const totalPts = series.totalPoints ?? 0;
  if (totalPts === 0) return false;
  const startTs = new Date(series.dateStarted).getTime();
  const endTs = new Date(series.dateExpectedComplete).getTime();
  const range = endTs - startTs;
  if (range <= 0) return false;
  const t = new Date(lastActual.date).getTime();
  const idealAtDate = t >= endTs ? 0 : totalPts * (1 - (t - startTs) / range);
  return lastActual.points > idealAtDate;
}

export function computeLateBlockers(allTasks, taskSeries) {
  const offTrackIds = new Set();
  const taskById = new Map();
  for (const t of allTasks) {
    taskById.set(t.taskId, t);
    const key = `${t.Workstream ?? ''}|${t.Epic ?? ''}|${t.Deliverable ?? ''}|${t.taskName ?? ''}`;
    const s = taskSeries[key];
    if (s && isSeriesOffTrack(s)) offTrackIds.add(t.taskId);
  }
  const results = [];
  for (const t of allTasks) {
    for (const blocker of (t.blockedBy ?? [])) {
      if (offTrackIds.has(blocker.id)) {
        results.push({
          blockedTaskId: t.taskId,
          blockedTaskName: t.taskName,
          blockedWorkstream: t.Workstream ?? 'Unknown',
          blockedEpic: t.Epic ?? 'Unknown',
          blockedDeliverable: t.Deliverable ?? 'Unknown',
          blockerTaskId: blocker.id,
          blockerName: blocker.name,
        });
      }
    }
  }
  return results;
}

export function computeOffTrackCounts(hierarchy, taskSeries, levelDates) {
  let tasks = 0, deliverables = 0, epics = 0, workstreams = 0;
  const offTrackNames = { tasks: [], deliverables: [], epics: [], workstreams: [] };

  for (const ws of hierarchy) {
    let wsOff = false;
    for (const epic of (ws.epics ?? [])) {
      let epicOff = false;
      for (const del of (epic.deliverables ?? [])) {
        let delOff = false;
        for (const task of (del.tasks ?? [])) {
          const key = `${task.Workstream ?? ''}|${task.Epic ?? ''}|${task.Deliverable ?? ''}|${task.taskName ?? ''}`;
          const s = taskSeries[key];
          if (s && isSeriesOffTrack(s)) {
            tasks++;
            offTrackNames.tasks.push({ name: task.taskName, url: task.url ?? null });
            delOff = true;
          }
        }
        if (delOff) {
          deliverables++;
          offTrackNames.deliverables.push({ name: del.name, url: del.url ?? null });
          epicOff = true;
        }
      }
      if (epicOff) {
        epics++;
        offTrackNames.epics.push({ name: epic.name, url: epic.url ?? null });
        wsOff = true;
      }
    }
    if (wsOff) {
      workstreams++;
      offTrackNames.workstreams.push({ name: ws.name, url: ws.url ?? null });
    }
  }
  return { tasks, deliverables, epics, workstreams, offTrackNames };
}
