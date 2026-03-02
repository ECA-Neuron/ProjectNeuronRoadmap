const REBASELINE_STORAGE_KEY = 'erp_rebaseline_dates';
const REBASELINE_LOG_KEY = 'erp_rebaseline_log';
const REBASELINE_COUNTS_KEY = 'erp_rebaseline_counts';

function taskId(row) {
  const w = row.Workstream ?? row.workstream ?? '';
  const e = row.Epic ?? row.epic ?? '';
  const d = row.Deliverable ?? row.deliverable ?? '';
  const t = row.Task ?? row.task ?? row.Name ?? row.name ?? '';
  return `${w}|${e}|${d}|${t}`;
}

function nodeId(level, name) {
  return `${level}::${name}`;
}

export function getStoredDates() {
  try {
    const raw = localStorage.getItem(REBASELINE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDates(byTaskId) {
  try {
    localStorage.setItem(REBASELINE_STORAGE_KEY, JSON.stringify(byTaskId));
  } catch (e) {
    console.warn('Could not save rebaseline dates', e);
  }
}

function getChangeCounts() {
  try {
    const raw = localStorage.getItem(REBASELINE_COUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChangeCounts(counts) {
  try {
    localStorage.setItem(REBASELINE_COUNTS_KEY, JSON.stringify(counts));
  } catch {}
}

export function getRebaselineLog() {
  try {
    const raw = localStorage.getItem(REBASELINE_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function appendRebaselineLog(entry) {
  try {
    const log = getRebaselineLog();
    log.push({ ...entry, at: new Date().toISOString() });
    if (log.length > 200) log.splice(0, log.length - 200);
    localStorage.setItem(REBASELINE_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.warn('Could not append rebaseline log', e);
  }
}

function extractDates(row) {
  const dateField = row.Date ?? row.date ?? null;
  let dateStarted = row.dateStarted ?? null;
  let dateExpectedComplete = row.dateExpectedComplete ?? null;
  if (!dateStarted && dateField) {
    if (typeof dateField === 'object' && dateField.start) {
      dateStarted = dateField.start;
      if (!dateExpectedComplete && dateField.end) dateExpectedComplete = dateField.end;
    } else if (typeof dateField === 'string') {
      dateStarted = dateField;
    }
  }
  return { dateStarted, dateExpectedComplete };
}

export function detectAndPersistRebaselines(roadmapRows) {
  const stored = getStoredDates();
  const updates = { ...stored };
  const changed = [];

  for (const row of roadmapRows) {
    const id = taskId(row);
    const dateStarted = row.dateStarted ?? row['Date started'] ?? null;
    const dateExpectedComplete = row.dateExpectedComplete ?? row['Date expected to complete'] ?? row.due ?? null;
    const prev = stored[id];

    const startedChanged = dateStarted != null && prev?.dateStarted != null && prev.dateStarted !== dateStarted;
    const completeChanged = dateExpectedComplete != null && prev?.dateExpectedComplete != null && prev.dateExpectedComplete !== dateExpectedComplete;

    if (startedChanged || completeChanged) {
      changed.push({
        taskId: id,
        taskName: row.Task ?? row.task ?? row.Name ?? row.name,
        previous: prev,
        current: { dateStarted, dateExpectedComplete },
      });
      appendRebaselineLog({
        taskId: id,
        taskName: row.Task ?? row.task ?? row.Name ?? row.name,
        previous: prev,
        current: { dateStarted, dateExpectedComplete },
      });
    }

    updates[id] = { dateStarted: dateStarted ?? prev?.dateStarted ?? null, dateExpectedComplete: dateExpectedComplete ?? prev?.dateExpectedComplete ?? null };
  }

  saveDates(updates);
  return changed.map(c => c.taskId);
}

const SCHED_DATES_KEY = 'erp_scheduled_dates';

function getStoredScheduledDates() {
  try {
    const raw = localStorage.getItem(SCHED_DATES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredScheduledDates(data) {
  try {
    localStorage.setItem(SCHED_DATES_KEY, JSON.stringify(data));
  } catch {}
}

export function detectAllLevelDateChanges(roadmapRows) {
  const stored = getStoredScheduledDates();
  const counts = getChangeCounts();
  const updates = { ...stored };
  const newCounts = { ...counts };
  const newChanges = [];

  for (const task of roadmapRows) {
    const progressRows = task.progressRows ?? [];
    for (const row of progressRows) {
      const idNum = (row.idNum ?? '').trim();
      const scheduledDates = (row.scheduledDates ?? '').trim();
      if (!idNum || !scheduledDates) continue;

      const level = (row.logDeliverable ?? '').trim()
        ? 'Deliverable'
        : (row.logEpic ?? '').trim()
          ? 'Epic'
          : (row.logWorkstream ?? '').trim()
            ? 'Workstream'
            : 'Task';

      const name = level === 'Deliverable' ? row.logDeliverable
        : level === 'Epic' ? row.logEpic
        : level === 'Workstream' ? row.logWorkstream
        : task.taskName;

      const key = `sched::${idNum}`;
      const prev = stored[key];

      if (prev && prev.scheduledDates !== scheduledDates) {
        if (!newCounts[key]) newCounts[key] = 0;
        newCounts[key]++;

        newChanges.push({
          id: key,
          idNum,
          level,
          name,
          taskName: task.taskName,
          changeNumber: newCounts[key],
          prevDates: prev.scheduledDates,
          newDates: scheduledDates,
        });

        appendRebaselineLog({
          nodeId: key,
          idNum,
          level,
          name,
          previous: prev.scheduledDates,
          current: scheduledDates,
        });
      }

      updates[key] = { scheduledDates, level, name, taskName: task.taskName, idNum };
    }
  }

  saveStoredScheduledDates(updates);
  saveChangeCounts(newCounts);

  const allDateChanges = [];
  const allCounts = { ...newCounts };
  for (const [key, entry] of Object.entries(updates)) {
    if (allCounts[key] && allCounts[key] > 0) {
      allDateChanges.push({
        id: key,
        idNum: entry.idNum,
        level: entry.level,
        name: entry.name,
        taskName: entry.taskName,
        changeNumber: allCounts[key],
        currentDates: entry.scheduledDates,
        isNew: newChanges.some(c => c.id === key),
      });
    }
  }

  return { newChanges, allDateChanges };
}

export function getRebaselinedTaskIds(roadmapRows) {
  const stored = getStoredDates();
  const changedIds = new Set();

  for (const row of roadmapRows) {
    const id = taskId(row);
    const dateStarted = row.dateStarted ?? row['Date started'] ?? null;
    const dateExpectedComplete = row.dateExpectedComplete ?? row['Date expected to complete'] ?? row.due ?? null;
    const prev = stored[id];
    if (!prev) continue;
    if (dateStarted != null && prev.dateStarted != null && prev.dateStarted !== dateStarted) changedIds.add(id);
    if (dateExpectedComplete != null && prev.dateExpectedComplete != null && prev.dateExpectedComplete !== dateExpectedComplete) changedIds.add(id);
  }

  return changedIds;
}
