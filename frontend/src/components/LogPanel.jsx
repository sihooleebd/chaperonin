import { useEffect, useRef } from 'react';

function fmtTime(ts) {
  return new Date(ts).toTimeString().slice(0, 8);
}

export default function LogPanel({ logs, open, onToggle }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs, open]);

  const lastEvent = logs[logs.length - 1];

  return (
    <div className="log-panel">
      <div className="log-header" onClick={onToggle}>
        <span className="log-toggle">{open ? '▾' : '▸'}</span>
        <span>Logs</span>
        {logs.length > 0 && (
          <span className="log-count">{logs.filter((l) => l.type === 'node.log').length} lines</span>
        )}
        {lastEvent?.type === 'pipeline.done' && (
          <span className="log-done-badge">Pipeline complete ✓</span>
        )}
        {lastEvent?.type === 'pipeline.error' && (
          <span className="log-error-badge">Pipeline error ✗</span>
        )}
        <span className="log-header-spacer" />
        <span className="log-hint">{open ? 'Click to collapse' : 'Click to expand'}</span>
      </div>

      {open && (
        <div className="log-body" ref={bodyRef}>
          {logs.length === 0 && <div className="log-empty">Run the pipeline to see logs.</div>}
          {logs.map((entry, i) => <LogLine key={i} entry={entry} />)}
        </div>
      )}
    </div>
  );
}

function LogLine({ entry }) {
  if (entry.type === 'pipeline.start') {
    return (
      <div className="log-line log-line--event">
        <span className="log-ts">{fmtTime(entry.ts)}</span>
        <span className="log-system">▶ Pipeline started ({entry.total} nodes)</span>
      </div>
    );
  }
  if (entry.type === 'pipeline.done') {
    return (
      <div className="log-line log-line--done">
        <span className="log-ts">{fmtTime(entry.ts)}</span>
        <span className="log-system">✓ Pipeline complete</span>
      </div>
    );
  }
  if (entry.type === 'pipeline.error') {
    return (
      <div className="log-line log-line--error">
        <span className="log-ts">{fmtTime(entry.ts)}</span>
        <span className="log-system">✗ {entry.message ?? 'Pipeline error'}</span>
      </div>
    );
  }
  if (entry.type === 'node.queued') {
    return (
      <div className="log-line log-line--event">
        <span className="log-ts">{fmtTime(entry.ts)}</span>
        <span className="log-node-id" style={{ color: '#f59e0b' }}>{entry.nodeId}</span>
        <span className="log-event-text">queued</span>
      </div>
    );
  }
  if (entry.type === 'node.running') {
    return (
      <div className="log-line log-line--event">
        <span className="log-ts">{fmtTime(entry.ts)}</span>
        <span className="log-node-id" style={{ color: '#3b82f6' }}>{entry.nodeId}</span>
        <span className="log-event-text">running</span>
      </div>
    );
  }
  if (entry.type === 'node.done') {
    return (
      <div className="log-line log-line--event">
        <span className="log-ts">{fmtTime(entry.ts)}</span>
        <span className="log-node-id" style={{ color: '#10b981' }}>{entry.nodeId}</span>
        <span className="log-event-text">done</span>
      </div>
    );
  }
  if (entry.type === 'node.log') {
    return (
      <div className="log-line">
        <span className="log-ts">{fmtTime(entry.ts)}</span>
        <span className="log-node-id">{entry.nodeId}</span>
        <span className="log-text">{entry.line}</span>
      </div>
    );
  }
  return null;
}
