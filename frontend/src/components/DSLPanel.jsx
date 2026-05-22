import { useState } from 'react';
import { CATEGORIES, TYPE_COLORS, INPUT_TYPES, CONTROL_NODES, CONTROL_CATEGORIES } from '../data/modules';

export default function DSLPanel({ dslText, dslDirty, onDslChange, onApplyDsl,
                                   selectedNode, onParamChange, onNodeDataChange }) {
  const [tab, setTab] = useState('dsl');

  return (
    <aside className="dsl-panel">
      <div className="dsl-tabs">
        <button className={`dsl-tab${tab === 'dsl' ? ' dsl-tab--active' : ''}`} onClick={() => setTab('dsl')}>
          DSL
          {dslDirty && <span className="dsl-dirty-dot" title="Unsaved edits" />}
        </button>
        <button className={`dsl-tab${tab === 'props' ? ' dsl-tab--active' : ''}`} onClick={() => setTab('props')}>
          Properties
          {selectedNode && <span className="dsl-badge">{selectedNode.data.module?.label || selectedNode.type}</span>}
        </button>
      </div>

      {tab === 'dsl' && (
        <div className="dsl-body">
          <textarea
            className="dsl-textarea"
            value={dslText}
            onChange={(e) => onDslChange(e.target.value)}
            spellCheck={false}
          />
          <div className="dsl-actions">
            <button className={`btn-apply${dslDirty ? ' btn-apply--active' : ''}`}
                    onClick={onApplyDsl} disabled={!dslDirty}>
              Apply DSL
            </button>
            {dslDirty && <span className="dsl-dirty-hint">Edited — apply to sync canvas</span>}
          </div>
        </div>
      )}

      {tab === 'props' && (
        <div className="props-body">
          {!selectedNode
            ? <div className="props-empty">Click a node to inspect it</div>
            : <NodeProps node={selectedNode} onParamChange={onParamChange} onNodeDataChange={onNodeDataChange} />
          }
        </div>
      )}
    </aside>
  );
}

function NodeProps({ node, onParamChange, onNodeDataChange }) {
  if (node.type === 'input-node') return <InputProps node={node} onChange={onNodeDataChange} />;
  if (node.type === 'output-node') return <OutputProps node={node} onChange={onNodeDataChange} />;
  if (node.type === 'control-node') return <ControlProps node={node} onParamChange={onParamChange} />;
  if (!node.data?.module) {
    return <div className="props-empty">No properties available for this node.</div>;
  }
  return <ModuleProps node={node} onParamChange={onParamChange} />;
}

function ControlProps({ node, onParamChange }) {
  const spec = CONTROL_NODES[node.data.kind];
  if (!spec) {
    return <div className="props-empty">Unknown control kind: {String(node.data.kind)}</div>;
  }
  const params = node.data.params || {};
  const catDef = CONTROL_CATEGORIES[spec.category] || { color: '#94a3b8' };
  return (
    <div className="node-props">
      <div className="props-heading" style={{ borderLeftColor: catDef.color }}>
        <div style={{ color: catDef.color, fontWeight: 700, fontSize: 13 }}>{spec.label}</div>
        <div style={{ color: '#6b7280', fontSize: 10, fontFamily: 'var(--mono)', marginTop: 2 }}>{spec.id}</div>
      </div>
      {spec.params.length > 0 && (
        <div className="props-section">
          <div className="props-section-label">Parameters</div>
          {spec.params.map((p) => (
            <div key={p.id} className="props-param">
              <label className="props-param-label">{p.id}</label>
              {p.choices ? (
                <select className="props-param-input"
                        value={params[p.id] ?? p.default}
                        onChange={(e) => onParamChange(node.id, p.id, e.target.value)}>
                  {p.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input className="props-param-input"
                       value={params[p.id] ?? p.default ?? ''}
                       onChange={(e) => {
                         const raw = e.target.value;
                         onParamChange(node.id, p.id, isNaN(raw) || raw === '' ? raw : Number(raw));
                       }} />
              )}
              <span className="props-param-type">{p.type}</span>
            </div>
          ))}
        </div>
      )}
      {spec.inputs.length > 0 && (
        <div className="props-section">
          <div className="props-section-label">Inputs</div>
          {spec.inputs.map((i) => (
            <div key={i.id} className="props-row">
              <span className="props-key">{i.id}</span>
              <span className="props-type">{i.type}</span>
            </div>
          ))}
        </div>
      )}
      {spec.outputs.length > 0 && (
        <div className="props-section">
          <div className="props-section-label">Outputs</div>
          {spec.outputs.map((o) => (
            <div key={o.id} className="props-row">
              <span className="props-key">{o.id}</span>
              <span className="props-type">{o.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InputProps({ node, onChange }) {
  const { varName, label, dataType } = node.data;
  const color = TYPE_COLORS[dataType] || '#10b981';
  return (
    <div className="node-props">
      <div className="props-heading" style={{ borderLeftColor: '#10b981' }}>
        <div style={{ color: '#10b981', fontWeight: 700, fontSize: 13 }}>Input Node</div>
        <div style={{ color: '#6b7280', fontSize: 10, fontFamily: 'var(--mono)', marginTop: 2 }}>{varName}</div>
      </div>
      <div className="props-section">
        <div className="props-section-label">Name</div>
        <div className="props-param">
          <input className="props-param-input" value={label}
                 onChange={(e) => onChange(node.id, { label: e.target.value })} />
        </div>
      </div>
      <div className="props-section">
        <div className="props-section-label">Data Type</div>
        <div className="props-param">
          <select className="props-param-input props-select" value={dataType}
                  onChange={(e) => onChange(node.id, { dataType: e.target.value })} style={{ color }}>
            {INPUT_TYPES.map((t) => (
              <option key={t} value={t} style={{ color: TYPE_COLORS[t] || '#6b7280' }}>{t}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function OutputProps({ node, onChange }) {
  const { varName, label, inferredType } = node.data;
  return (
    <div className="node-props">
      <div className="props-heading" style={{ borderLeftColor: '#f59e0b' }}>
        <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>Output Node</div>
        <div style={{ color: '#6b7280', fontSize: 10, fontFamily: 'var(--mono)', marginTop: 2 }}>{varName}</div>
      </div>
      <div className="props-section">
        <div className="props-section-label">Name</div>
        <div className="props-param">
          <input className="props-param-input" value={label}
                 onChange={(e) => onChange(node.id, { label: e.target.value })} />
        </div>
      </div>
      {inferredType && (
        <div className="props-section">
          <div className="props-section-label">Inferred Type</div>
          <div className="props-row">
            <span className="props-key" style={{ color: TYPE_COLORS[inferredType] }}>{inferredType}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleProps({ node, onParamChange }) {
  const { module: mod, params = {}, status } = node.data;
  const cat = CATEGORIES[mod.category] || { color: '#6b7280' };

  return (
    <div className="node-props">
      <div className="props-heading" style={{ borderLeftColor: cat.color }}>
        <div style={{ color: cat.color, fontWeight: 700, fontSize: 13 }}>{mod.label}</div>
        <div style={{ color: '#6b7280', fontSize: 10, fontFamily: 'var(--mono)', marginTop: 2 }}>{mod.id}</div>
      </div>

      {mod.inputs.length > 0 && (
        <div className="props-section">
          <div className="props-section-label">Inputs</div>
          {mod.inputs.map((inp) => (
            <div key={inp.id} className="props-row">
              <span className="props-key" style={{ color: TYPE_COLORS[inp.type] }}>{inp.id}</span>
              <span className="props-type">{inp.type}</span>
            </div>
          ))}
        </div>
      )}

      {mod.params.length > 0 && (
        <div className="props-section">
          <div className="props-section-label">Parameters</div>
          {mod.params.map((p) => (
            <div key={p.id} className="props-param">
              <label className="props-param-label">{p.id}</label>
              <input className="props-param-input"
                     value={params[p.id] !== undefined ? params[p.id] : p.default}
                     onChange={(e) => {
                       const raw = e.target.value;
                       onParamChange(node.id, p.id, isNaN(raw) || raw === '' ? raw : Number(raw));
                     }}
                     disabled={status === 'running'} />
              <span className="props-param-type">{p.type}</span>
            </div>
          ))}
        </div>
      )}

      {mod.outputs.length > 0 && (
        <div className="props-section">
          <div className="props-section-label">Outputs</div>
          {mod.outputs.map((out) => (
            <div key={out.id} className="props-row">
              <span className="props-key" style={{ color: TYPE_COLORS[out.type] }}>{out.id}</span>
              <span className="props-type">{out.type}</span>
            </div>
          ))}
        </div>
      )}

      <div className="props-section">
        <div className="props-section-label">Resources</div>
        <div className="props-row">
          <span className="props-key">GPU</span>
          <span className="props-type">{mod.resources.gpu > 0 ? `${mod.resources.gpu}×` : 'none'}</span>
        </div>
        <div className="props-row">
          <span className="props-key">Memory</span>
          <span className="props-type">{mod.resources.memory_gb} GB</span>
        </div>
        <div className="props-row">
          <span className="props-key">Cache</span>
          <span className="props-type">{mod.retention}</span>
        </div>
      </div>
    </div>
  );
}
