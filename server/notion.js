const path = require('path');
const { Client } = require('@notionhq/client');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const notion = new Client({
  auth: process.env.NOTION_SECRET,
});

function parseProperty(prop) {
  if (!prop) return null;
  if (prop.type === 'title' && prop.title?.length) return prop.title.map(t => t.plain_text).join('');
  if (prop.type === 'rich_text' && prop.rich_text?.length) return prop.rich_text.map(t => t.plain_text).join('');
  if (prop.type === 'number') return prop.number;
  if (prop.type === 'date') {
    if (!prop.date?.start) return null;
    const start = new Date(prop.date.start).toISOString().slice(0, 10);
    const end = prop.date.end ? new Date(prop.date.end).toISOString().slice(0, 10) : null;
    return end ? { start, end } : start;
  }
  if (prop.type === 'select') return prop.select?.name ?? null;
  if (prop.type === 'relation' && prop.relation?.length) return prop.relation[0]?.id ?? null;
  if (prop.type === 'checkbox') return prop.checkbox;
  if (prop.type === 'url') return prop.url;
  if (prop.type === 'formula' && prop.formula?.type === 'string') return prop.formula.string;
  if (prop.type === 'formula' && prop.formula?.type === 'number') return prop.formula.number;
  if (prop.type === 'formula' && prop.formula?.type === 'date') return prop.formula.date?.start ?? null;
  if (prop.type === 'people' && prop.people?.length) return prop.people.map(p => p.name ?? p.person?.email ?? 'Unknown').join(', ');
  if (prop.type === 'status') return prop.status?.name ?? null;
  return null;
}

function pageToRow(page) {
  const out = { id: page.id, created: page.created_time, lastEdited: page.last_edited_time, url: page.url ?? null };
  if (!page.properties) return out;
  for (const [key, prop] of Object.entries(page.properties)) {
    const value = parseProperty(prop);
    if (value !== null && value !== undefined) out[key] = value;
    if (prop.type === 'relation' && prop.relation?.length > 0) {
      out[`__rel_${key}`] = prop.relation.map(r => r.id);
    }
  }
  return out;
}

async function queryAllPages(databaseId) {
  const results = [];
  let cursor = undefined;
  do {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...resp.results);
    cursor = resp.next_cursor;
  } while (cursor);
  return results.map(pageToRow);
}

async function queryNotionDatabase(databaseId) {
  if (!process.env.NOTION_SECRET) throw new Error('NOTION_SECRET is not set');
  if (!databaseId) throw new Error('Database ID is required');
  const pages = await notion.databases.query({
    database_id: databaseId,
    page_size: 100,
  });
  let rows = pages.results.map(pageToRow);
  let nextCursor = pages.next_cursor;
  while (nextCursor) {
    const next = await notion.databases.query({
      database_id: databaseId,
      start_cursor: nextCursor,
      page_size: 100,
    });
    rows = rows.concat(next.results.map(pageToRow));
    nextCursor = next.next_cursor;
  }
  return rows;
}

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : v;
}

function extractDateRange(row) {
  const dateField = row.Date ?? row.date ?? null;
  let dateStarted = null;
  let dateExpectedComplete = null;
  if (dateField && typeof dateField === 'object' && dateField.start) {
    dateStarted = dateField.start;
    dateExpectedComplete = dateField.end ?? null;
  } else if (typeof dateField === 'string') {
    dateStarted = dateField;
  }
  if (dateStarted && !dateExpectedComplete && row['Estimated Days']) {
    const start = new Date(dateStarted);
    if (!isNaN(start.getTime())) {
      start.setDate(start.getDate() + Number(row['Estimated Days']));
      dateExpectedComplete = start.toISOString().slice(0, 10);
    }
  }
  return { dateStarted, dateExpectedComplete };
}

async function getMergedRoadmap() {
  const roadmapId = process.env.NOTION_ROADMAP_DB_ID;
  const workstreamsId = process.env.NOTION_WORKSTREAMS_DB_ID;
  if (!roadmapId || !workstreamsId) throw new Error('NOTION_ROADMAP_DB_ID and NOTION_WORKSTREAMS_DB_ID must be set');

  const [roadmapRows, workstreamsRows] = await Promise.all([
    queryNotionDatabase(roadmapId),
    queryNotionDatabase(workstreamsId),
  ]);

  const wsById = new Map();
  for (const row of workstreamsRows) {
    wsById.set(row.id, row);
  }

  const progressByTaskId = new Map();
  for (const row of roadmapRows) {
    const taskId = row.Task ?? row.task ?? null;
    if (!taskId) continue;
    if (!progressByTaskId.has(taskId)) progressByTaskId.set(taskId, []);
    progressByTaskId.get(taskId).push(row);
  }

  const allTasks = workstreamsRows.filter(r => r.Level === 'Task');
  const mergedTasks = allTasks.map(wsRow => {
    const taskId = wsRow.id;
    const taskName = wsRow.Name ?? wsRow.name ?? 'Unknown';
    const totalPoints = parseFloat(wsRow['Total Points']) || 0;
    const { dateStarted, dateExpectedComplete } = extractDateRange(wsRow);

    const progressRows = progressByTaskId.get(taskId) ?? [];
    const latestProgress = progressRows.length > 0
      ? progressRows.sort((a, b) => (a.lastEdited ?? '').localeCompare(b.lastEdited ?? '')).at(-1)
      : null;

    const currentPoints = latestProgress
      ? (parseFloat(trimStr(latestProgress['Current Points '] ?? latestProgress['Current Points'] ?? '0')) || 0)
      : 0;
    const remainingPoints = Math.max(0, totalPoints - currentPoints);
    const percentComplete = latestProgress
      ? (parseFloat(trimStr(latestProgress['Percent Complete'] ?? '0')) || 0)
      : 0;

    const parentId = wsRow['Parent (L1)'] ?? wsRow['__rel_Parent (L1)']?.[0] ?? null;
    const parentRow = parentId ? wsById.get(parentId) : null;
    const grandparentName = trimStr(wsRow.Grandparent ?? '');

    const deliverable = (parentRow ? trimStr(parentRow.Name ?? parentRow.name ?? '') : '') || trimStr(wsRow['Deliverable Level'] ?? '') || 'Unknown';
    const epic = grandparentName || trimStr(wsRow.Grandparent ?? '') || 'Unknown';
    const workstream = trimStr(wsRow.GreatGrandParent ?? wsRow.WorkStream ?? wsRow.workstream ?? '') || 'Unknown';

    const assignee = trimStr(wsRow.Assign ?? wsRow.assign ?? wsRow.Assignee ?? wsRow.assignee ?? '') || 'Unassigned';

    const blockedByIds = wsRow['__rel_Blocked by'] ?? [];
    const blockingIds = wsRow['__rel_Blocking'] ?? [];
    const blockedBy = blockedByIds.map(id => {
      const r = wsById.get(id);
      return { id, name: r ? trimStr(r.Name ?? r.name ?? 'Unknown') : id };
    });
    const blocking = blockingIds.map(id => {
      const r = wsById.get(id);
      return { id, name: r ? trimStr(r.Name ?? r.name ?? 'Unknown') : id };
    });

    const text = trimStr(wsRow.Text ?? '');
    const estimatedDays = parseFloat(wsRow['Estimated Days']) || null;
    const typeOfScope = trimStr(wsRow['Type of Scope '] ?? wsRow['Type of Scope'] ?? '');
    const levelOfRisk = trimStr(wsRow['Level of Risk'] ?? '');
    const status = trimStr(wsRow.Status ?? '');
    const url = wsRow.url ?? null;

    return {
      taskId,
      taskName,
      totalPoints,
      currentPoints,
      remainingPoints,
      percentComplete,
      dateStarted,
      dateExpectedComplete,
      assignee,
      blockedBy,
      blocking,
      text,
      estimatedDays,
      typeOfScope,
      levelOfRisk,
      status,
      url,
      Workstream: workstream,
      Epic: epic,
      Deliverable: deliverable,
      progressRows: progressRows
        .sort((a, b) => (a.lastEdited ?? a.created ?? '').localeCompare(b.lastEdited ?? b.created ?? ''))
        .map((r, i, arr) => {
          const pct = parseFloat(trimStr(r['Percent Complete'] ?? '0')) || 0;
          const prevPct = i > 0 ? (parseFloat(trimStr(arr[i - 1]['Percent Complete'] ?? '0')) || 0) : 0;
          return {
            date: r['Date Added'] ?? r.lastEdited ?? r.created,
            updateNumber: r['Update number'] ?? r.id,
            idNum: trimStr(r['Id Num'] ?? ''),
            userName: trimStr(r['Update Name'] ?? ''),
            comment: trimStr(r['Reason for Update'] ?? ''),
            currentPoints: parseFloat(trimStr(r['Current Points '] ?? r['Current Points'] ?? '0')) || 0,
            pointsAdded: parseFloat(trimStr(r['Points Added'] ?? r.pointsAdded ?? '0')) || 0,
            percentComplete: pct,
            prevPercentComplete: prevPct,
            scheduledDates: trimStr(r['Scheduled Dates'] ?? ''),
            logDeliverable: trimStr(r['Deliverable'] ?? ''),
            logWorkstream: trimStr(r['Workstream'] ?? ''),
            logEpic: trimStr(r['Epic'] ?? ''),
          };
        }),
    };
  });

  const deliverableRows = workstreamsRows.filter(r => r.Level === 'Deliverable');
  const deliverableDates = {};
  for (const d of deliverableRows) {
    const { dateStarted, dateExpectedComplete } = extractDateRange(d);
    deliverableDates[trimStr(d.Name ?? '')] = { dateStarted, dateExpectedComplete };
  }

  const epicRows = workstreamsRows.filter(r => r.Level === 'Epic');
  const epicDates = {};
  for (const e of epicRows) {
    const { dateStarted, dateExpectedComplete } = extractDateRange(e);
    epicDates[trimStr(e.Name ?? '')] = { dateStarted, dateExpectedComplete };
  }

  const workstreamRows = workstreamsRows.filter(r => r.Level === 'Workstream');
  const workstreamDates = {};
  for (const w of workstreamRows) {
    const { dateStarted, dateExpectedComplete } = extractDateRange(w);
    workstreamDates[trimStr(w.Name ?? '')] = { dateStarted, dateExpectedComplete };
  }

  const thirdDbId = process.env.NOTION_THIRD_DB_ID;
  let openIssues = [];
  if (thirdDbId) {
    try {
      const issueRows = await queryNotionDatabase(thirdDbId);
      const issuesMapped = issueRows.map(row => {
        const relatedTaskId = row['Related Task'] ?? null;
        const wsTask = relatedTaskId ? wsById.get(relatedTaskId) : null;
        return {
          id: row.id,
          url: row.url ?? null,
          name: trimStr(row['Issue Name'] ?? row['Name'] ?? row.name ?? ''),
          status: trimStr(row.Status ?? row.status ?? 'Unknown'),
          severity: trimStr(row['Severity '] ?? row.Severity ?? row.severity ?? ''),
          category: trimStr(row['Issue Category'] ?? ''),
          description: trimStr(row['Issue Description'] ?? ''),
          deliverable: trimStr(row['Related Deliverable'] ?? ''),
          epic: trimStr(row['Related Epic'] ?? ''),
          assignedTo: trimStr(row['Assigned To'] ?? ''),
          dateCreated: row['Date Created'] ?? row.created,
          relatedTaskId,
          relatedTaskName: wsTask ? trimStr(wsTask.Name ?? wsTask.name ?? '') : '',
          workstream: wsTask ? trimStr(wsTask.WorkStream ?? wsTask.GreatGrandParent ?? '') : '',
          comments: [],
        };
      });

      const commentResults = await Promise.allSettled(
        issuesMapped.map(issue =>
          notion.blocks.children.list({ block_id: issue.id, page_size: 50 })
            .then(res => {
              const comments = [];
              for (const block of res.results) {
                const richText = block[block.type]?.rich_text;
                if (!richText?.length) continue;
                const text = richText.map(t => t.plain_text).join('').trim();
                if (!text) continue;
                comments.push({
                  text,
                  createdTime: block.created_time,
                  lastEdited: block.last_edited_time,
                });
              }
              return { id: issue.id, comments };
            })
        )
      );
      for (const result of commentResults) {
        if (result.status === 'fulfilled' && result.value.comments.length > 0) {
          const issue = issuesMapped.find(i => i.id === result.value.id);
          if (issue) issue.comments = result.value.comments;
        }
      }
      openIssues = issuesMapped;
    } catch (err) {
      console.error('Open issues fetch error:', err.message);
    }
  }

  return {
    roadmapRows: mergedTasks,
    workstreamsRows,
    hierarchy: buildHierarchy(mergedTasks, workstreamsRows),
    deliverableDates,
    epicDates,
    workstreamDates,
    openIssues,
  };
}

function buildHierarchy(tasks, workstreamsRows) {
  const byWorkstream = new Map();
  const urlMap = { workstream: {}, epic: {}, deliverable: {} };

  if (workstreamsRows) {
    const rowById = new Map(workstreamsRows.map(r => [r.id, r]));

    for (const row of workstreamsRows) {
      const name = trimStr(row.Name ?? row.name ?? '');
      const level = row.Level ?? '';
      const ws = trimStr(row.WorkStream ?? row.GreatGrandParent ?? '');
      const url = row.url ?? null;
      if (level === 'Workstream' && name) {
        if (!byWorkstream.has(name)) byWorkstream.set(name, new Map());
        if (url) urlMap.workstream[name] = url;
      }
      if (level === 'Epic' && ws && name) {
        if (!byWorkstream.has(ws)) byWorkstream.set(ws, new Map());
        const byEpic = byWorkstream.get(ws);
        if (!byEpic.has(name)) byEpic.set(name, new Map());
        if (url) urlMap.epic[name] = url;
      }
      if (level === 'Deliverable' && ws && name) {
        const parentId = row['Parent (L1)'];
        const parentRow = parentId ? rowById.get(parentId) : null;
        const epicName = parentRow ? trimStr(parentRow.Name ?? parentRow.name ?? '') : trimStr(row.Grandparent ?? '');
        if (!byWorkstream.has(ws)) byWorkstream.set(ws, new Map());
        const byEpic = byWorkstream.get(ws);
        const epic = epicName || 'Unknown';
        if (!byEpic.has(epic)) byEpic.set(epic, new Map());
        const byDel = byEpic.get(epic);
        if (!byDel.has(name)) byDel.set(name, []);
        if (url) urlMap.deliverable[name] = url;
      }
    }
  }

  for (const task of tasks) {
    const ws = task.Workstream ?? 'Unknown';
    if (!byWorkstream.has(ws)) byWorkstream.set(ws, new Map());
    const byEpic = byWorkstream.get(ws);
    const epic = task.Epic ?? 'Unknown';
    if (!byEpic.has(epic)) byEpic.set(epic, new Map());
    const byDeliverable = byEpic.get(epic);
    const del = task.Deliverable ?? 'Unknown';
    if (!byDeliverable.has(del)) byDeliverable.set(del, []);
    byDeliverable.get(del).push(task);
  }

  const tree = [];
  for (const [workstream, epics] of byWorkstream) {
    const epicList = [];
    let allTasksWs = [];
    for (const [epic, deliverables] of epics) {
      const delList = [];
      let allTasksEpic = [];
      for (const [deliverable, tasks] of deliverables) {
        const totalPoints = tasks.reduce((s, t) => s + (t.totalPoints ?? 0), 0);
        const currentPoints = tasks.reduce((s, t) => s + (t.currentPoints ?? 0), 0);
        delList.push({ name: deliverable, tasks, totalPoints, currentPoints, remainingPoints: Math.max(0, totalPoints - currentPoints), url: urlMap.deliverable[deliverable] ?? null });
        allTasksEpic = allTasksEpic.concat(tasks);
      }
      const epicTotalPts = allTasksEpic.reduce((s, t) => s + (t.totalPoints ?? 0), 0);
      const epicCurrPts = allTasksEpic.reduce((s, t) => s + (t.currentPoints ?? 0), 0);
      epicList.push({ name: epic, deliverables: delList, tasks: allTasksEpic, totalPoints: epicTotalPts, currentPoints: epicCurrPts, url: urlMap.epic[epic] ?? null });
      allTasksWs = allTasksWs.concat(allTasksEpic);
    }
    const wsTotalPts = allTasksWs.reduce((s, t) => s + (t.totalPoints ?? 0), 0);
    const wsCurrPts = allTasksWs.reduce((s, t) => s + (t.currentPoints ?? 0), 0);
    tree.push({ name: workstream, epics: epicList, tasks: allTasksWs, totalPoints: wsTotalPts, currentPoints: wsCurrPts, url: urlMap.workstream[workstream] ?? null });
  }
  return tree;
}

module.exports = {
  queryNotionDatabase,
  getMergedRoadmap,
  buildHierarchy,
  parseProperty,
  pageToRow,
};
