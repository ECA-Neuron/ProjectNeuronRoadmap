const path = require('path');
const { Client } = require('@notionhq/client');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const notion = new Client({
  auth: process.env.NOTION_SECRET,
});

/* ── HTML → Notion blocks converter ── */

function htmlToNotionBlocks(html) {
  if (!html || !html.trim()) return [];

  function decode(s) {
    return s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  }

  function parseInline(fragment) {
    const parts = [];
    let bold = false, italic = false, underline = false, buf = '';
    function flush() {
      const t = decode(buf);
      buf = '';
      if (!t) return;
      const rt = { text: { content: t } };
      const a = {};
      if (bold) a.bold = true;
      if (italic) a.italic = true;
      if (underline) a.underline = true;
      if (Object.keys(a).length) rt.annotations = a;
      parts.push(rt);
    }
    for (let i = 0; i < fragment.length; i++) {
      if (fragment[i] === '<') {
        const j = fragment.indexOf('>', i);
        if (j === -1) { buf += fragment[i]; continue; }
        const raw = fragment.slice(i + 1, j);
        const closing = raw[0] === '/';
        const tag = (closing ? raw.slice(1) : raw).split(/[\s/]/)[0].toLowerCase();
        if (tag === 'br') buf += '\n';
        else if (tag === 'b' || tag === 'strong') { flush(); bold = !closing; }
        else if (tag === 'i' || tag === 'em') { flush(); italic = !closing; }
        else if (tag === 'u') { flush(); underline = !closing; }
        i = j;
      } else {
        buf += fragment[i];
      }
    }
    flush();
    return parts;
  }

  let s = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|blockquote|li|h[1-6]|ul|ol)>/gi, '\n')
    .replace(/<(?:div|p|blockquote|ul|ol)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<li(?:\s[^>]*)?>/gi, '\n')
    .replace(/<(h[1-3])(?:\s[^>]*)?>/gi, '\n<$1>')
    .replace(/<\/(h[1-3])>/gi, '</$1>\n');

  const blocks = [];
  for (let line of s.split('\n')) {
    line = line.trim();
    if (!line) continue;

    const hm = line.match(/^<h([1-3])>([\s\S]*?)<\/h\1>$/i);
    if (hm) {
      const rt = parseInline(hm[2]);
      if (rt.length && rt.some(r => r.text.content.trim())) {
        const k = `heading_${hm[1]}`;
        blocks.push({ object: 'block', type: k, [k]: { rich_text: rt } });
      }
      continue;
    }

    const content = line.replace(/<\/?(div|p|blockquote|ul|ol|li|span|font)(?:\s[^>]*)?>/gi, '');
    const plain = decode(content.replace(/<[^>]+>/g, '')).trim();
    if (!plain) continue;

    if (/^[-•*]\s/.test(plain) || /^[-•*]$/.test(plain)) {
      const rt = parseInline(content);
      if (rt.length) {
        rt[0] = { ...rt[0], text: { ...rt[0].text, content: rt[0].text.content.replace(/^[-•*]\s*/, '') } };
        if (!rt[0].text.content.trim() && rt.length > 1) rt.shift();
      }
      if (rt.length && rt.some(r => r.text.content.trim())) {
        blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt } });
      }
      continue;
    }

    const rt = parseInline(content);
    if (rt.length && rt.some(r => r.text.content.trim())) {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt } });
    }
  }
  return blocks;
}

let _notionUsersCache = null;
async function getNotionUsers() {
  if (_notionUsersCache) return _notionUsersCache;
  const users = [];
  let cursor;
  do {
    const resp = await notion.users.list({ start_cursor: cursor, page_size: 100 });
    users.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  _notionUsersCache = users;
  return users;
}

async function resolveNotionUser(nameStr) {
  if (!nameStr) return null;
  const users = await getNotionUsers();
  const target = nameStr.trim().toLowerCase();
  const match = users.find(u =>
    (u.name ?? '').toLowerCase() === target ||
    (u.person?.email ?? '').toLowerCase().startsWith(target.split(' ')[0])
  );
  return match ? { object: 'user', id: match.id } : null;
}

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

function resolveAncestry(rowById, row) {
  const result = { deliverable: '', epic: '', workstream: '' };
  let currentId = row['Parent (L1)'] ?? row['__rel_Parent (L1)']?.[0] ?? null;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const ancestor = rowById.get(currentId);
    if (!ancestor) break;
    const name = trimStr(ancestor.Name ?? ancestor.name ?? '');
    const level = (ancestor.Level ?? '').trim();
    if (level === 'Deliverable' && !result.deliverable) result.deliverable = name;
    else if (level === 'Epic' && !result.epic) result.epic = name;
    else if (level === 'Workstream' && !result.workstream) result.workstream = name;
    currentId = ancestor['Parent (L1)'] ?? ancestor['__rel_Parent (L1)']?.[0] ?? null;
  }
  return result;
}

async function getMergedRoadmap(extraProgressRows = []) {
  const roadmapId = process.env.NOTION_ROADMAP_DB_ID;
  const workstreamsId = process.env.NOTION_WORKSTREAMS_DB_ID;
  if (!roadmapId || !workstreamsId) throw new Error('NOTION_ROADMAP_DB_ID and NOTION_WORKSTREAMS_DB_ID must be set');

  const [roadmapRows, workstreamsRows] = await Promise.all([
    queryNotionDatabase(roadmapId),
    queryNotionDatabase(workstreamsId),
  ]);

  if (extraProgressRows.length) {
    const existingIds = new Set(roadmapRows.map(r => r.id));
    for (const extra of extraProgressRows) {
      if (!existingIds.has(extra.id)) {
        roadmapRows.push(extra);
      }
    }
  }

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

    const percentComplete = latestProgress
      ? (parseFloat(trimStr(latestProgress['Percent Complete'] ?? '0')) || 0)
      : 0;
    const rawCurrentPoints = latestProgress
      ? (parseFloat(trimStr(latestProgress['Current Points '] ?? latestProgress['Current Points'] ?? '0')) || 0)
      : 0;
    const currentPoints = percentComplete > 0 ? totalPoints * percentComplete : rawCurrentPoints;
    const remainingPoints = Math.max(0, totalPoints - currentPoints);

    const ancestry = resolveAncestry(wsById, wsRow);
    const workstream = ancestry.workstream || trimStr(wsRow.GreatGrandParent ?? wsRow.WorkStream ?? wsRow.workstream ?? '') || 'Unknown';
    let epic;
    if (ancestry.epic) {
      epic = ancestry.epic;
    } else {
      const fallback = trimStr(wsRow.Grandparent ?? '');
      epic = (fallback && fallback !== workstream) ? fallback : 'Other';
    }
    const deliverable = ancestry.deliverable || trimStr(wsRow['Deliverable Level'] ?? '') || 'Unknown';

    const assignee = (trimStr(wsRow.Assign ?? wsRow.assign ?? wsRow.Assignee ?? wsRow.assignee ?? '') || 'Unassigned').replace(/^@/, '');

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
            userName: (trimStr(r['Update Name'] ?? '')).replace(/^@/, ''),
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
        })
        .filter((r, i, arr) => i === 0 || r.percentComplete !== arr[i - 1].percentComplete),
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
  const idMap = { workstream: {}, epic: {}, deliverable: {} };

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
        if (row.id) idMap.workstream[name] = row.id;
      }
      if (level === 'Epic' && name) {
        const anc = resolveAncestry(rowById, row);
        const wsName = anc.workstream || ws;
        if (wsName) {
          if (!byWorkstream.has(wsName)) byWorkstream.set(wsName, new Map());
          const byEpic = byWorkstream.get(wsName);
          if (!byEpic.has(name)) byEpic.set(name, new Map());
          if (url) urlMap.epic[name] = url;
          if (row.id) idMap.epic[name] = row.id;
        }
      }
      if (level === 'Deliverable' && name) {
        const anc = resolveAncestry(rowById, row);
        const wsName = anc.workstream || ws;
        if (wsName) {
          let epicFinal;
          if (anc.epic) {
            epicFinal = anc.epic;
          } else {
            const fallback = trimStr(row.Grandparent ?? '');
            epicFinal = (fallback && fallback !== wsName) ? fallback : 'Other';
          }
          if (!byWorkstream.has(wsName)) byWorkstream.set(wsName, new Map());
          const byEpic = byWorkstream.get(wsName);
          if (!byEpic.has(epicFinal)) byEpic.set(epicFinal, new Map());
          const byDel = byEpic.get(epicFinal);
          if (!byDel.has(name)) byDel.set(name, []);
          if (url) urlMap.deliverable[name] = url;
          if (row.id) idMap.deliverable[name] = row.id;
        }
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
        delList.push({ name: deliverable, tasks, totalPoints, currentPoints, remainingPoints: Math.max(0, totalPoints - currentPoints), url: urlMap.deliverable[deliverable] ?? null, notionId: idMap.deliverable[deliverable] ?? null });
        allTasksEpic = allTasksEpic.concat(tasks);
      }
      const epicTotalPts = allTasksEpic.reduce((s, t) => s + (t.totalPoints ?? 0), 0);
      const epicCurrPts = allTasksEpic.reduce((s, t) => s + (t.currentPoints ?? 0), 0);
      epicList.push({ name: epic, deliverables: delList, tasks: allTasksEpic, totalPoints: epicTotalPts, currentPoints: epicCurrPts, url: urlMap.epic[epic] ?? null, notionId: idMap.epic[epic] ?? null });
      allTasksWs = allTasksWs.concat(allTasksEpic);
    }
    const wsTotalPts = allTasksWs.reduce((s, t) => s + (t.totalPoints ?? 0), 0);
    const wsCurrPts = allTasksWs.reduce((s, t) => s + (t.currentPoints ?? 0), 0);
    tree.push({ name: workstream, epics: epicList, tasks: allTasksWs, totalPoints: wsTotalPts, currentPoints: wsCurrPts, url: urlMap.workstream[workstream] ?? null, notionId: idMap.workstream[workstream] ?? null });
  }
  return tree;
}

async function pushMeetingToNotion({ weekLabel, weekDate, openIssues }) {
  const dbId = process.env.NOTION_MEETINGS_DB_ID;
  if (!dbId) throw new Error('NOTION_MEETINGS_DB_ID is not set');

  const properties = {
    Week: { title: [{ text: { content: weekLabel } }] },
    'Week Date': { date: { start: weekDate } },
  };

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties,
  });

  const blocks = [];

  if (openIssues?.length > 0) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: `Open Issues (${openIssues.length})` } }] },
    });
    for (const issue of openIssues) {
      const parts = [issue.name];
      if (issue.severity) parts.push(`[${issue.severity}]`);
      if (issue.assignedTo) parts.push(`— ${issue.assignedTo}`);
      if (issue.workstream) parts.push(`(${issue.workstream})`);
      if (issue.taskName) parts.push(`→ ${issue.taskName}`);
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ text: { content: parts.join('  ') } }] },
      });
    }
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  }

  if (blocks.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < blocks.length; i += BATCH) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: blocks.slice(i, i + BATCH),
      });
    }
  }

  return { url: page.url, id: page.id };
}

async function pushPersonNotesToNotion({ pageId, personName, thisWeekNotes, nextWeekNotes, generalNotes, updates, totalBurned, notes, actionItems }) {
  const allBlocks = [];
  let cursor = undefined;
  do {
    const resp = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    allBlocks.push(...resp.results);
    cursor = resp.next_cursor;
  } while (cursor);

  let insertAfter = null;

  if (personName !== 'General') {
    let foundHeading = false;
    for (let i = 0; i < allBlocks.length; i++) {
      const b = allBlocks[i];
      if (b.type === 'heading_2') {
        const text = (b.heading_2.rich_text ?? []).map(t => t.plain_text).join('');
        if (foundHeading) {
          insertAfter = allBlocks[i - 1]?.id ?? null;
          break;
        }
        if (text.trim() === personName.trim()) {
          foundHeading = true;
        }
      }
      if (foundHeading && b.type === 'divider') {
        insertAfter = allBlocks[i - 1]?.id ?? null;
        break;
      }
    }
    if (foundHeading && !insertAfter && allBlocks.length > 0) {
      insertAfter = allBlocks[allBlocks.length - 1].id;
    }
  }

  if (!insertAfter && allBlocks.length > 0) {
    insertAfter = allBlocks[allBlocks.length - 1].id;
  }

  const blocks = [];
  const effectiveThisWeek = thisWeekNotes || notes || '';
  const effectiveNextWeek = nextWeekNotes || '';

  blocks.push({ object: 'block', type: 'divider', divider: {} });
  blocks.push({
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{
        text: { content: personName === 'General' ? 'General — This Week' : `${personName} — This Week` },
        annotations: { italic: true },
      }],
    },
  });

  if (updates?.length > 0) {
    for (const u of updates) {
      const pctStr = `${Math.round((u.prevPct ?? 0) * 100)}% → ${Math.round((u.pct ?? 0) * 100)}%`;
      let line = `${u.taskName}  (${pctStr})`;
      if (u.comment) line += ` — "${u.comment}"`;
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ text: { content: line } }] },
      });
    }
  }

  if (totalBurned != null && totalBurned > 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: `Points burned: ${totalBurned}` }, annotations: { bold: true } }],
      },
    });
  }

  blocks.push(...htmlToNotionBlocks(effectiveThisWeek));

  blocks.push({
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{
        text: { content: personName === 'General' ? 'General — Next Week' : `${personName} — Next Week` },
        annotations: { italic: true },
      }],
    },
  });

  const nextWeekBlocks = htmlToNotionBlocks(effectiveNextWeek);
  if (nextWeekBlocks.length > 0) {
    blocks.push(...nextWeekBlocks);
  } else {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content: '(No notes yet)' }, annotations: { italic: true, color: 'gray' } }] },
    });
  }

  const generalBlocks = htmlToNotionBlocks(generalNotes || '');
  if (generalBlocks.length > 0) {
    blocks.push({
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{
          text: { content: personName === 'General' ? 'General Notes' : `${personName} — General Notes` },
          annotations: { italic: true },
        }],
      },
    });
    blocks.push(...generalBlocks);
  }

  const appendPayload = { block_id: pageId, children: blocks };
  if (insertAfter) appendPayload.after = insertAfter;

  await notion.blocks.children.append(appendPayload);
  return { ok: true };
}

async function pushProgressUpdate({ taskId, percentComplete, comment, userName, workstream, epic, deliverable }) {
  const roadmapId = process.env.NOTION_ROADMAP_DB_ID;
  if (!roadmapId) throw new Error('NOTION_ROADMAP_DB_ID is not set');

  const properties = {
    'Task': { relation: [{ id: taskId }] },
    'Percent Complete': { rich_text: [{ text: { content: String(percentComplete / 100) } }] },
    'Reason for Update': { rich_text: [{ text: { content: comment || '' } }] },
    'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } },
  };
  if (userName) {
    properties['Update Name'] = { rich_text: [{ text: { content: userName } }] };
  }
  if (workstream) {
    properties['Workstream'] = { rich_text: [{ text: { content: workstream } }] };
  }
  if (epic) {
    properties['Epic'] = { rich_text: [{ text: { content: epic } }] };
  }
  if (deliverable) {
    properties['Deliverable'] = { rich_text: [{ text: { content: deliverable } }] };
  }

  const page = await notion.pages.create({
    parent: { database_id: roadmapId },
    properties,
  });
  return { id: page.id, url: page.url };
}

async function createWorkstreamItem({ name, level, parentId, startDate, endDate, estimatedDays, totalPoints, levelOfRisk, typeOfScope, status, text }) {
  const dbId = process.env.NOTION_WORKSTREAMS_DB_ID;
  if (!dbId) throw new Error('NOTION_WORKSTREAMS_DB_ID is not set');
  if (!name || !level) throw new Error('name and level are required');

  const properties = {
    Name: { title: [{ text: { content: name } }] },
    Level: { select: { name: level } },
  };

  if (parentId) {
    properties['Parent (L1)'] = { relation: [{ id: parentId }] };
  }

  if (startDate) {
    properties.Date = { date: { start: startDate, end: endDate || null } };
  }
  if (estimatedDays != null && estimatedDays !== '') {
    properties['Estimated Days'] = { number: Number(estimatedDays) };
  }
  if (totalPoints != null && totalPoints !== '') {
    properties['Total Points'] = { number: Number(totalPoints) };
  }
  if (levelOfRisk) {
    properties['Level of Risk'] = { select: { name: levelOfRisk } };
  }
  if (typeOfScope) {
    properties['Type of Scope '] = { select: { name: typeOfScope } };
  }
  if (status) {
    properties.Status = { status: { name: status } };
  }
  if (text) {
    properties.Text = { rich_text: [{ text: { content: text } }] };
  }

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties,
  });
  return { id: page.id, url: page.url };
}

async function updateItemDates({ pageId, start, end }) {
  const dateValue = start ? { start, end: end || null } : null;
  await notion.pages.update({
    page_id: pageId,
    properties: { Date: { date: dateValue } },
  });
  return { ok: true };
}

async function updateIssue({ pageId, status, severity, assignedTo }) {
  const properties = {};
  if (status != null) {
    properties.Status = { status: { name: status } };
  }
  if (severity != null) {
    properties['Severity '] = { select: { name: severity } };
  }
  if (assignedTo != null) {
    const user = await resolveNotionUser(assignedTo);
    if (user) {
      properties['Assigned To'] = { people: [user] };
    }
  }
  if (Object.keys(properties).length === 0) throw new Error('No fields to update');
  await notion.pages.update({ page_id: pageId, properties });
  return { ok: true };
}

async function addIssueComment({ pageId, comment }) {
  if (!comment) throw new Error('Comment text is required');
  await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: comment } }] },
      },
    ],
  });
  return { ok: true };
}

async function createIssue({ name, description, status, severity, assignedTo, relatedTaskId, deliverable, epic, category }) {
  const dbId = process.env.NOTION_THIRD_DB_ID;
  if (!dbId) throw new Error('NOTION_THIRD_DB_ID is not set');
  if (!name) throw new Error('Issue name is required');

  const properties = {
    'Issue Name': { title: [{ text: { content: name } }] },
  };
  if (description) {
    properties['Issue Description'] = { rich_text: [{ text: { content: description } }] };
  }
  if (status) {
    properties.Status = { status: { name: status } };
  }
  if (severity) {
    properties['Severity '] = { select: { name: severity } };
  }
  if (assignedTo) {
    const user = await resolveNotionUser(assignedTo);
    if (user) {
      properties['Assigned To'] = { people: [user] };
    }
  }
  if (relatedTaskId) {
    properties['Related Task'] = { relation: [{ id: relatedTaskId }] };
  }
  if (deliverable) {
    properties['Related Deliverable'] = { rich_text: [{ text: { content: deliverable } }] };
  }
  if (epic) {
    properties['Related Epic'] = { rich_text: [{ text: { content: epic } }] };
  }
  if (category) {
    properties['Issue Category'] = { select: { name: category } };
  }

  properties['Date Created'] = { date: { start: new Date().toISOString().slice(0, 10) } };

  const page = await notion.pages.create({ parent: { database_id: dbId }, properties });
  return { ok: true, id: page.id, url: page.url };
}

module.exports = {
  queryNotionDatabase,
  getMergedRoadmap,
  buildHierarchy,
  parseProperty,
  pageToRow,
  pushMeetingToNotion,
  pushPersonNotesToNotion,
  updateItemDates,
  pushProgressUpdate,
  createWorkstreamItem,
  updateIssue,
  addIssueComment,
  createIssue,
};
