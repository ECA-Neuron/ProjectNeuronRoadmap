import React, { useState, useEffect } from 'react';

function nodeKey(type, ...parts) {
  return [type, ...parts].join('|');
}

const LEVEL_BADGES = { workstream: ['WS', 'badge-ws'], epic: ['EP', 'badge-ep'], deliverable: ['DL', 'badge-del'], task: ['TK', 'badge-tk'] };
function LevelBadge({ level }) {
  const [label, cls] = LEVEL_BADGES[level] ?? ['', ''];
  return <span className={`tree-level-badge ${cls}`}>{label}</span>;
}

function NotionLink({ url }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="tree-notion-link"
      title="Open in Notion"
      onClick={e => e.stopPropagation()}
    >
      &#8599;
    </a>
  );
}

export default function HierarchyTree({ hierarchy, selected, onSelect, rebaselinedTaskKeys, filterLevel, filterWorkstream, filterDeliverable }) {
  const [expanded, setExpanded] = useState({ workstream: {}, epic: {}, deliverable: {} });

  const toggleAndSelect = (level, key, selectPayload) => {
    const wasOpen = expanded[level]?.[key] === true;
    const isAlreadySelected = selected?.key === selectPayload.key;
    const shouldClose = wasOpen && isAlreadySelected;
    setExpanded(s => ({ ...s, [level]: { ...s[level], [key]: !shouldClose } }));
    if (!shouldClose) onSelect(selectPayload);
  };

  useEffect(() => {
    if (!selected) return;
    setExpanded(s => {
      const next = { workstream: { ...s.workstream }, epic: { ...s.epic }, deliverable: { ...s.deliverable } };
      if (selected.type === 'task') {
        const parts = selected.key.split('|');
        if (parts.length >= 4) {
          const [ws, epic, del] = parts;
          next.workstream[`workstream|${ws}`] = true;
          next.epic[`epic|${ws}|${epic}`] = true;
          next.deliverable[`deliverable|${ws}|${epic}|${del}`] = true;
        }
      } else if (selected.type === 'deliverable') {
        const parts = selected.key.split('|');
        if (parts.length >= 4) {
          next.workstream[`workstream|${parts[1]}`] = true;
          next.epic[`epic|${parts[1]}|${parts[2]}`] = true;
        }
      } else if (selected.type === 'epic') {
        const parts = selected.key.split('|');
        if (parts.length >= 3) {
          next.workstream[`workstream|${parts[1]}`] = true;
        }
      } else if (selected.type === 'workstream') {
        next.workstream[selected.key] = true;
      }
      return next;
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector('.tree-label.selected');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }, [selected]);

  const autoExpand = !!filterDeliverable;
  const isExpanded = (level, key) => autoExpand || expanded[level]?.[key] === true;
  const isSelected = (type, key) => selected?.type === type && selected?.key === key;

  if (!hierarchy?.length) return <p className="hierarchy-empty">No hierarchy data. Check Notion connection.</p>;

  const filtered = filterWorkstream
    ? hierarchy.filter(ws => ws.name === filterWorkstream)
    : hierarchy;

  const isFiltered = !!filterLevel;

  return (
    <nav className={`hierarchy-tree ${isFiltered ? 'filtered' : ''}`}>
      <ul className="tree-list">
        {filtered.map(ws => {
          const wsKey = nodeKey('workstream', ws.name);
          if (filterLevel === 'task') {
            return (
              <li key={wsKey} className="tree-node workstream">
                <div className="tree-group-label">
                  {ws.name}
                  <NotionLink url={ws.url} />
                </div>
                <ul className="tree-list">
                  {ws.epics?.flatMap(epic =>
                    epic.deliverables?.flatMap(del =>
                      del.tasks?.map(t => {
                        const taskName = t.taskName ?? '';
                        const tKey = `${ws.name}|${epic.name}|${del.name}|${taskName}`;
                        const isRebaselined = rebaselinedTaskKeys?.has(t.taskId ?? tKey);
                        return (
                          <li key={tKey} className="tree-node task">
                            <button
                              type="button"
                              className={`tree-label ${isSelected('task', tKey) ? 'selected' : ''}`}
                              onClick={() => onSelect({ type: 'task', key: tKey, name: taskName, tasks: [t], url: t.url })}
                            >
                              <span className="tree-icon task-icon">•</span>
                              <LevelBadge level="task" />
                              <span className="tree-name">{taskName || 'Task'}</span>
                              <span className="tree-pts">{t.totalPoints ?? 0} pts</span>
                              {isRebaselined && <span className="rebaseline-badge">Date changed</span>}
                              <NotionLink url={t.url} />
                            </button>
                          </li>
                        );
                      })
                    )
                  )}
                </ul>
              </li>
            );
          }
          if (filterLevel === 'deliverable') {
            return (
              <li key={wsKey} className="tree-node workstream">
                <div className="tree-group-label">
                  {ws.name}
                  <NotionLink url={ws.url} />
                </div>
                <ul className="tree-list">
                  {ws.epics?.flatMap(epic =>
                    epic.deliverables?.map(del => {
                      const delKey = nodeKey('deliverable', ws.name, epic.name, del.name);
                      return (
                        <li key={delKey} className="tree-node deliverable flat">
                          <button
                            type="button"
                            className={`tree-label ${isSelected('deliverable', delKey) ? 'selected' : ''}`}
                            onClick={() => onSelect({ type: 'deliverable', key: delKey, name: del.name, tasks: del.tasks ?? [], url: del.url })}
                          >
                            <LevelBadge level="deliverable" />
                            <span className="tree-name">{del.name}</span>
                            <span className="tree-pts">{del.totalPoints ?? 0} pts</span>
                            <NotionLink url={del.url} />
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </li>
            );
          }
          return (
            <li key={wsKey} className="tree-node workstream">
              <button
                type="button"
                className={`tree-label ${isSelected('workstream', wsKey) ? 'selected' : ''}`}
                onClick={() => toggleAndSelect('workstream', wsKey, { type: 'workstream', key: wsKey, name: ws.name, tasks: ws.tasks ?? [], url: ws.url })}
              >
                <span className="tree-icon">{isExpanded('workstream', wsKey) ? '▾' : '▸'}</span>
                <LevelBadge level="workstream" />
                <span className="tree-name">{ws.name}</span>
                <span className="tree-pts">{ws.totalPoints ?? 0} pts</span>
                <NotionLink url={ws.url} />
              </button>
              {isExpanded('workstream', wsKey) && (
                <ul className="tree-list">
                  {ws.epics?.map(epic => {
                    const epicKey = nodeKey('epic', ws.name, epic.name);
                    return (
                      <li key={epicKey} className="tree-node epic">
                        <button
                          type="button"
                          className={`tree-label ${isSelected('epic', epicKey) ? 'selected' : ''}`}
                          onClick={() => toggleAndSelect('epic', epicKey, { type: 'epic', key: epicKey, name: epic.name, tasks: epic.tasks ?? [], url: epic.url })}
                        >
                          <span className="tree-icon">{isExpanded('epic', epicKey) ? '▾' : '▸'}</span>
                          <LevelBadge level="epic" />
                          <span className="tree-name">{epic.name}</span>
                          <span className="tree-pts">{epic.totalPoints ?? 0} pts</span>
                          <NotionLink url={epic.url} />
                        </button>
                        {isExpanded('epic', epicKey) && (
                          <ul className="tree-list">
                            {epic.deliverables?.map(del => {
                              const delKey = nodeKey('deliverable', ws.name, epic.name, del.name);
                              return (
                                <li key={delKey} className="tree-node deliverable">
                                  <button
                                    type="button"
                                    className={`tree-label ${isSelected('deliverable', delKey) ? 'selected' : ''}`}
                                    onClick={() => toggleAndSelect('deliverable', delKey, { type: 'deliverable', key: delKey, name: del.name, tasks: del.tasks ?? [], url: del.url })}
                                  >
                                    <span className="tree-icon">{isExpanded('deliverable', delKey) ? '▾' : '▸'}</span>
                                    <LevelBadge level="deliverable" />
                                    <span className="tree-name">{del.name}</span>
                                    <span className="tree-pts">{del.totalPoints ?? 0} pts</span>
                                    <NotionLink url={del.url} />
                                  </button>
                                  {isExpanded('deliverable', delKey) && (
                                    <ul className="tree-list">
                                      {del.tasks?.map(t => {
                                        const taskName = t.taskName ?? '';
                                        const tKey = `${ws.name}|${epic.name}|${del.name}|${taskName}`;
                                        const isRebaselined = rebaselinedTaskKeys?.has(t.taskId ?? tKey);
                                        return (
                                          <li key={tKey} className="tree-node task">
                                            <button
                                              type="button"
                                              className={`tree-label ${isSelected('task', tKey) ? 'selected' : ''}`}
                                              onClick={() => onSelect({ type: 'task', key: tKey, name: taskName, tasks: [t], url: t.url })}
                                            >
                                              <span className="tree-icon task-icon">•</span>
                                              <LevelBadge level="task" />
                                              <span className="tree-name">{taskName || 'Task'}</span>
                                              <span className="tree-pts">{t.totalPoints ?? 0} pts</span>
                                              {isRebaselined && <span className="rebaseline-badge">Date changed</span>}
                                              <NotionLink url={t.url} />
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
