import { Handle, Position, useReactFlow } from 'reactflow';
import { CONTROL_NODES, TYPE_COLORS } from '../data/modules';

const STATUS_COLOR = {
  idle: '#475569', queued: '#94a3b8',
  running: '#0ea5e9', done: '#10b981',
  failed: '#ef4444', skipped: '#64748b',
};

const CATEGORY_ACCENT = {
  control:  '#f97316',
  variable: '#a855f7',
  utility:  '#94a3b8',
};

export default function ControlNode({ id, data, selected }) {
  const spec = CONTROL_NODES[data.kind];
  const { setNodes } = useReactFlow();
  if (!spec) return null;

  const accent = CATEGORY_ACCENT[spec.category] || '#94a3b8';
  const params = data.params || {};
  const status = data.status || 'idle';
  const statusColor = STATUS_COLOR[status] || STATUS_COLOR.idle;

  const onParamChange = (pid, value) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, params: { ...n.data.params, [pid]: value } } }
          : n
      )
    );
  };

  const handleStyle = (color) => ({
    background: color, width: 9, height: 9, border: '2px solid #0d1117',
  });

  return (
    <div
      className={`control-node${selected ? ' control-node--selected' : ''}`}
      style={{ borderColor: accent }}
    >
      <div className="control-node-title">
        <span style={{ color: accent }}>{spec.label.toUpperCase()}</span>
        <span className="control-node-status" style={{ color: statusColor }}>
          {status}
        </span>
      </div>

      {/* Render params inline */}
      {spec.params.length > 0 && (
        <div className="control-node-params">
          {spec.params.map((p) => (
            <label key={p.id} className="control-node-param">
              <span>{p.id}</span>
              {p.choices ? (
                <select
                  className="nodrag"
                  value={params[p.id] ?? p.default}
                  onChange={(e) => onParamChange(p.id, e.target.value)}
                >
                  {p.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input
                  className="nodrag"
                  value={params[p.id] ?? p.default ?? ''}
                  onChange={(e) => onParamChange(p.id, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      )}

      {/* Input handles */}
      {spec.inputs.map((inp, i) => (
        <Handle
          key={`in-${inp.id}`}
          type="target"
          position={Position.Top}
          id={inp.id}
          title={`${inp.id}: ${inp.type}`}
          style={{
            ...handleStyle(TYPE_COLORS[inp.type] || accent),
            left: `${((i + 0.5) / Math.max(spec.inputs.length, 1)) * 100}%`,
          }}
        />
      ))}

      {/* Port labels for clarity */}
      {(spec.inputs.length > 1 || spec.outputs.length > 1) && (
        <div className="control-node-ports">
          {spec.inputs.length > 1 && (
            <div className="control-node-port-row control-node-port-row--in">
              {spec.inputs.map((inp) => (
                <span key={inp.id} className="control-node-port-label">{inp.id}</span>
              ))}
            </div>
          )}
          {spec.outputs.length > 1 && (
            <div className="control-node-port-row control-node-port-row--out">
              {spec.outputs.map((out) => (
                <span
                  key={out.id}
                  className="control-node-port-label"
                  style={out.id === 'if_true' ? { color: '#10b981' }
                       : out.id === 'if_false' ? { color: '#ef4444' }
                       : undefined}
                >
                  {out.id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Output handles */}
      {spec.outputs.map((out, i) => {
        const baseColor = TYPE_COLORS[out.type] || accent;
        const color = out.id === 'if_true' ? '#10b981'
                     : out.id === 'if_false' ? '#ef4444'
                     : baseColor;
        return (
          <Handle
            key={`out-${out.id}`}
            type="source"
            position={Position.Bottom}
            id={out.id}
            title={`${out.id}: ${out.type}`}
            style={{
              ...handleStyle(color),
              left: `${((i + 0.5) / Math.max(spec.outputs.length, 1)) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}
