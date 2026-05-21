/**
 * WebSocket interceptor — frontend ↔ Python orchestrator bridge.
 *
 * ─── PROTOCOL ───────────────────────────────────────────────────────────────
 *
 * Frontend → Backend  (JSON messages sent over WebSocket):
 *
 *   { "type": "run",    "pipeline": <PipelinePayload> }
 *   { "type": "cancel" }
 *
 * Backend → Frontend  (JSON events streamed over the same WebSocket):
 *
 *   { "type": "pipeline.start",  "total": <int>          }
 *   { "type": "node.queued",     "nodeId": <str>          }
 *   { "type": "node.running",    "nodeId": <str>          }
 *   { "type": "node.progress",   "nodeId": <str>,
 *                                "current": <int>,
 *                                "total": <int>           }
 *   { "type": "node.log",        "nodeId": <str>,
 *                                "line": <str>            }
 *   { "type": "node.done",       "nodeId": <str>          }
 *   { "type": "node.cancelled",  "nodeId": <str>          }
 *   { "type": "pipeline.done"                             }  ← terminal (success)
 *   { "type": "pipeline.error",  "message": <str>         }  ← terminal (failure)
 *
 * The backend MUST emit "pipeline.done" OR "pipeline.error" as the final
 * event — backend.run() resolves/rejects on these and App.jsx uses that to
 * flip isRunning back to false.
 *
 * ─── PipelinePayload ────────────────────────────────────────────────────────
 * See graph.js → serializePipeline() for the exact JSON shape.
 * ────────────────────────────────────────────────────────────────────────────
 */

// Set VITE_BACKEND_WS in your .env to override.
// With the Vite dev proxy (vite.config.js) you can also leave this as-is and
// the proxy will forward /ws → ws://localhost:8000/ws automatically.
const WS_URL = import.meta.env.VITE_BACKEND_WS ?? 'ws://localhost:8000/ws';

class PipelineBackend {
  constructor() {
    this._ws             = null;
    this._status         = 'disconnected'; // 'connecting'|'connected'|'disconnected'|'error'
    this._onStatusChange = null;
    this._runResolve     = null;
    this._runReject      = null;
    this._onEvent        = null;
    this._reconnectTimer = null;
  }

  get status() { return this._status; }

  // Call once on mount. onStatusChange(status) fires on every transition.
  connect(onStatusChange) {
    this._onStatusChange = onStatusChange;
    this._openSocket();
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    if (this._ws) {
      this._ws.onclose = null; // suppress auto-reconnect
      this._ws.close();
      this._ws = null;
    }
    this._setStatus('disconnected');
  }

  // Returns a Promise that resolves on pipeline.done, rejects on pipeline.error
  // or if the connection drops mid-run.
  run(pipeline, onEvent) {
    if (this._status !== 'connected') {
      return Promise.reject(
        new Error(`Not connected to backend (status: ${this._status})`)
      );
    }

    return new Promise((resolve, reject) => {
      this._runResolve = resolve;
      this._runReject  = reject;
      this._onEvent    = onEvent;

      this._ws.send(JSON.stringify({ type: 'run', pipeline }));
    });
  }

  cancel() {
    if (this._ws && this._status === 'connected') {
      this._ws.send(JSON.stringify({ type: 'cancel' }));
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  _openSocket() {
    if (this._ws) return;
    this._setStatus('connecting');

    const ws = new WebSocket(WS_URL);
    this._ws  = ws;

    ws.onopen = () => {
      this._setStatus('connected');
    };

    ws.onerror = () => {
      // onerror always fires just before onclose — let onclose handle reconnect
      this._setStatus('error');
    };

    ws.onclose = () => {
      this._ws = null;
      this._setStatus('disconnected');

      // If a run was in progress, reject it
      if (this._runReject) {
        this._runReject(new Error('WebSocket connection lost during pipeline run'));
        this._runResolve = null;
        this._runReject  = null;
        this._onEvent    = null;
      }

      // Auto-reconnect after 3 s
      this._reconnectTimer = setTimeout(() => this._openSocket(), 3000);
    };

    ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // Forward to active run handler
      if (this._onEvent) {
        this._onEvent(msg);
      }

      // Resolve/reject the run Promise on terminal events
      if (msg.type === 'pipeline.done') {
        this._runResolve?.();
        this._runResolve = null;
        this._runReject  = null;
        this._onEvent    = null;
      } else if (msg.type === 'pipeline.error') {
        this._runReject?.(new Error(msg.message ?? 'Unknown pipeline error'));
        this._runResolve = null;
        this._runReject  = null;
        this._onEvent    = null;
      }
    };
  }

  _setStatus(s) {
    this._status = s;
    this._onStatusChange?.(s);
  }
}

export const backend = new PipelineBackend();
