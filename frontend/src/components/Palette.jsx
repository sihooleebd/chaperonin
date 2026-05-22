import { MODULES, CATEGORIES, CONTROL_NODES, CONTROL_CATEGORIES } from '../data/modules';

const BY_CATEGORY = Object.values(MODULES).reduce((acc, mod) => {
  (acc[mod.category] ||= []).push(mod);
  return acc;
}, {});

const CONTROL_BY_CATEGORY = Object.values(CONTROL_NODES).reduce((acc, n) => {
  (acc[n.category] ||= []).push(n);
  return acc;
}, {});

const IO_ITEMS = [
  { id: 'input-node',  label: 'Input',  description: 'Pipeline data source', chipLabel: 'IN',  chipColor: '#10b981' },
  { id: 'output-node', label: 'Output', description: 'Pipeline result sink',  chipLabel: 'OUT', chipColor: '#f59e0b' },
];

export default function Palette({ hostGpu = false }) {
  const onDragStart = (e, id) => {
    e.dataTransfer.setData('application/chaperonin', id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const isGpuBlocked = (mod) => !hostGpu && (mod.resources?.gpu ?? 0) > 0;

  return (
    <aside className="palette">
      <div className="palette-title">Modules</div>

      <div className="palette-section">
        <div className="palette-section-header">
          <span className="palette-section-dot" style={{ background: '#94a3b8' }} />
          Pipeline I/O
        </div>
        {IO_ITEMS.map((item) => (
          <div key={item.id} className="palette-item" draggable onDragStart={(e) => onDragStart(e, item.id)} title={item.description}>
            <span className="palette-item-chip" style={{ background: item.chipColor + '22', color: item.chipColor }}>
              {item.chipLabel}
            </span>
            <div className="palette-item-text">
              <div className="palette-item-name">{item.label}</div>
              <div className="palette-item-desc">{item.description}</div>
            </div>
          </div>
        ))}
      </div>

      {Object.entries(BY_CATEGORY).map(([cat, mods]) => {
        const catDef = CATEGORIES[cat];
        return (
          <div key={cat} className="palette-section">
            <div className="palette-section-header">
              <span className="palette-section-dot" style={{ background: catDef.color }} />
              {catDef.label}
            </div>
            {mods.map((mod) => {
              const blocked = isGpuBlocked(mod);
              const tip = blocked
                ? `${mod.description} — requires NVIDIA GPU (not available on this host)`
                : mod.description;
              return (
                <div
                  key={mod.id}
                  className={`palette-item${blocked ? ' palette-item--blocked' : ''}`}
                  draggable={!blocked}
                  onDragStart={blocked ? undefined : (e) => onDragStart(e, mod.id)}
                  title={tip}
                >
                  <span className="palette-item-chip" style={{ background: catDef.color + '22', color: catDef.color }}>
                    {mod.id.slice(0, 2)}
                  </span>
                  <div className="palette-item-text">
                    <div className="palette-item-name">
                      {mod.label}
                      {blocked && <span className="palette-item-gpu-tag">GPU</span>}
                    </div>
                    <div className="palette-item-desc">{mod.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {Object.entries(CONTROL_BY_CATEGORY).map(([cat, items]) => {
        const catDef = CONTROL_CATEGORIES[cat];
        return (
          <div key={`ctrl-${cat}`} className="palette-section">
            <div className="palette-section-header">
              <span className="palette-section-dot" style={{ background: catDef.color }} />
              {catDef.label}
            </div>
            {items.map((item) => (
              <div
                key={item.id}
                className="palette-item"
                draggable
                onDragStart={(e) => onDragStart(e, item.id)}
                title={item.description}
              >
                <span className="palette-item-chip" style={{ background: catDef.color + '22', color: catDef.color }}>
                  {item.id.slice(0, 2)}
                </span>
                <div className="palette-item-text">
                  <div className="palette-item-name">{item.label}</div>
                  <div className="palette-item-desc">{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      <div className="palette-footer">Drag to canvas to add</div>
    </aside>
  );
}
