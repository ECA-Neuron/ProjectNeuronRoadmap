import React, { useRef, useCallback, useEffect, useState } from 'react';

const COLORS = ['#ffffff', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

function cmd(command, value) {
  document.execCommand(command, false, value ?? null);
}

function queryActive(command) {
  try { return document.queryCommandState(command); } catch { return false; }
}

function getCurrentBlock() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 'p';
  let node = sel.anchorNode;
  while (node && node.nodeType !== 1) node = node.parentNode;
  if (!node) return 'p';
  const tag = node.tagName?.toLowerCase();
  if (['h1', 'h2', 'h3'].includes(tag)) return tag;
  return 'p';
}

function getCurrentColor() {
  try {
    const val = document.queryCommandValue('foreColor');
    if (!val) return null;
    if (val.startsWith('#')) return val.toLowerCase();
    const m = val.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) {
      const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
      return hex.toLowerCase();
    }
    return null;
  } catch { return null; }
}

export default function RichEditor({ value, onChange, placeholder }) {
  const editorRef = useRef(null);
  const lastHtml = useRef(value ?? '');
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== (value ?? '')) {
      editorRef.current.innerHTML = value ?? '';
      lastHtml.current = value ?? '';
    }
  }, [value]);

  const handleInput = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? '';
    if (html !== lastHtml.current) {
      lastHtml.current = html;
      onChange?.(html);
    }
  }, [onChange]);

  const refreshToolbar = useCallback(() => {
    forceUpdate(n => n + 1);
  }, []);

  const execCmd = useCallback((command, val) => {
    editorRef.current?.focus();
    cmd(command, val);
    handleInput();
    setTimeout(refreshToolbar, 10);
  }, [handleInput, refreshToolbar]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        cmd('outdent');
      } else {
        cmd('indent');
      }
      handleInput();
    }
    setTimeout(refreshToolbar, 10);
  }, [handleInput, refreshToolbar]);

  const handleMouseUp = useCallback(() => {
    setTimeout(refreshToolbar, 10);
  }, [refreshToolbar]);

  const isBold = queryActive('bold');
  const isItalic = queryActive('italic');
  const isUnderline = queryActive('underline');
  const isBullet = queryActive('insertUnorderedList');
  const isNumbered = queryActive('insertOrderedList');
  const currentBlock = getCurrentBlock();
  const currentColor = getCurrentColor();

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <div className="rich-toolbar-group">
          <button type="button" title="Bold (Ctrl+B)" className={`rich-btn ${isBold ? 'rich-btn-active' : ''}`} onMouseDown={e => { e.preventDefault(); execCmd('bold'); }}>
            <strong>B</strong>
          </button>
          <button type="button" title="Italic (Ctrl+I)" className={`rich-btn ${isItalic ? 'rich-btn-active' : ''}`} onMouseDown={e => { e.preventDefault(); execCmd('italic'); }}>
            <em>I</em>
          </button>
          <button type="button" title="Underline (Ctrl+U)" className={`rich-btn ${isUnderline ? 'rich-btn-active' : ''}`} onMouseDown={e => { e.preventDefault(); execCmd('underline'); }}>
            <u>U</u>
          </button>
        </div>

        <span className="rich-toolbar-sep" />

        <div className="rich-toolbar-group">
          <select
            className="rich-heading-select"
            value={currentBlock}
            onChange={e => {
              const tag = e.target.value;
              editorRef.current?.focus();
              document.execCommand('formatBlock', false, `<${tag}>`);
              handleInput();
              setTimeout(refreshToolbar, 10);
            }}
            title="Heading"
          >
            <option value="p">Normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
        </div>

        <span className="rich-toolbar-sep" />

        <div className="rich-toolbar-group">
          <button type="button" title="Bullet List (toggle)" className={`rich-btn ${isBullet ? 'rich-btn-active' : ''}`} onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList'); }}>
            &#8226;
          </button>
          <button type="button" title="Numbered List (toggle)" className={`rich-btn ${isNumbered ? 'rich-btn-active' : ''}`} onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList'); }}>
            1.
          </button>
          <button type="button" title="Indent (Tab)" className="rich-btn" onMouseDown={e => { e.preventDefault(); execCmd('indent'); }}>
            &#8677;
          </button>
          <button type="button" title="Outdent (Shift+Tab)" className="rich-btn" onMouseDown={e => { e.preventDefault(); execCmd('outdent'); }}>
            &#8676;
          </button>
        </div>

        <span className="rich-toolbar-sep" />

        <div className="rich-toolbar-group rich-color-group">
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              title={c === '#ffffff' ? 'White' : c}
              className={`rich-color-btn ${currentColor === c ? 'rich-color-active' : ''}`}
              style={{ background: c }}
              onMouseDown={e => { e.preventDefault(); execCmd('foreColor', c); }}
            >
              {currentColor === c && <span className="rich-color-check">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={editorRef}
        className="rich-content"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={handleInput}
        onBlur={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={refreshToolbar}
        onMouseUp={handleMouseUp}
        data-placeholder={placeholder ?? 'Start typing...'}
      />
    </div>
  );
}
