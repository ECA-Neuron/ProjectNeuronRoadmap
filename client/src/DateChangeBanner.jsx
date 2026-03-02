import React, { useState } from 'react';

function levelIcon(level) {
  switch ((level ?? '').toLowerCase()) {
    case 'workstream': return '◆';
    case 'epic': return '◇';
    case 'deliverable': return '▸';
    case 'task': return '·';
    default: return '•';
  }
}

export default function DateChangeBanner({ dateChanges }) {
  const [expanded, setExpanded] = useState(false);
  const items = dateChanges ?? [];
  if (items.length === 0) return null;

  const newCount = items.filter(c => c.isNew).length;
  const byLevel = {};
  for (const c of items) {
    const lvl = c.level || 'Unknown';
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(c);
  }
  const levelOrder = ['Workstream', 'Epic', 'Deliverable', 'Task'];

  return (
    <div className="date-change-banner">
      <div className="date-change-summary" onClick={() => setExpanded(e => !e)}>
        <span className="date-change-icon">&#128197;</span>
        <span className="date-change-count">
          {items.length} Scheduled Date Change{items.length !== 1 ? 's' : ''} Detected
        </span>
        {newCount > 0 && (
          <span className="date-change-new-badge">{newCount} new</span>
        )}
        <span className="date-change-toggle">{expanded ? 'Hide' : 'Show details'}</span>
      </div>
      {expanded && (
        <div className="date-change-detail">
          {levelOrder.filter(l => byLevel[l]).map(level => (
            <div key={level} className="date-change-level-group">
              <div className="date-change-level-header">{level} Date Changes ({byLevel[level].length})</div>
              <ul className="date-change-list">
                {byLevel[level].map(c => (
                  <li key={c.id} className={`date-change-item ${c.isNew ? 'new-change' : ''}`}>
                    <span className="date-change-item-icon">{levelIcon(level)}</span>
                    <div className="date-change-item-body">
                      <div className="date-change-item-top">
                        <span className="date-change-item-id">{c.idNum}</span>
                        <span className="date-change-item-name">
                          {level} date for <strong>{c.name}</strong> changed
                        </span>
                        <span className="date-change-item-num">Change #{c.changeNumber}</span>
                        {c.isNew && <span className="date-change-new-tag">NEW</span>}
                      </div>
                      {c.taskName && c.taskName !== c.name && (
                        <div className="date-change-item-task">Task: {c.taskName}</div>
                      )}
                      {c.currentDates && (
                        <div className="date-change-item-dates">
                          Current dates: {c.currentDates}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
