import React, { useState } from 'react';

function nodeKey(type, ...parts) {
  return [type, ...parts].join('|');
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

export default function HierarchyTree({ hierarchy, selected, onSelect, rebaselinedTaskKeys, filterLevel, filterWorkstream }) {
  const [expanded, setExpanded] = useState({ workstream: {}, epic: {}, deliverable: {} });

  const toggleAndSelect = (level, key, selectPayload) => {
    setExpanded(s => {
      const wasOpen = s[level]?.[key] === true;
      const shouldClose = wasOpen && selected?.key === selectPayload.key;
      return { ...s, [level]: { ...s[level], [key]: shouldClose ? false : true } };
    });
    onSelect(selectPayload);
  };

  const isExpanded = (level, key) => expanded[level]?.[key] === true;
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
