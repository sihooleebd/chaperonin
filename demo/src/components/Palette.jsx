import { MODULES, CATEGORIES } from '../data/modules';

const BY_CATEGORY = Object.values(MODULES).reduce((acc, mod) => {
  (acc[mod.category] ||= []).push(mod);
  return acc;
}, {});

const IO_ITEMS = [
  {
    id: 'input-node',
    label: 'Input',
    description: 'Pipeline data source',
    chipLabel: 'IN',
    chipColor: '#10b981',
  },
  {
    id: 'output-node',
    label: 'Output',
    description: 'Pipeline result sink',
    chipLabel: 'OUT',
    chipColor: '#f59e0b',
  },
];

export default function Palette() {
  const onDragStart = (e, id) => {
    e.dataTransfer.setData('application/chaperonin', id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="palette">
      <div className="palette-title">Modules</div>

      {/* ── Pipeline I/O ── */}
      <div className="palette-section">
        <div className="palette-section-header">
          <span className="palette-section-dot" style={{ background: '#94a3b8' }} />
          Pipeline I/O
        </div>
        {IO_ITEMS.map((item) => (
          <div
            key={item.id}
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, item.id)}
            title={item.description}
          >
            <span
              className="palette-item-chip"
              style={{ background: item.chipColor + '22', color: item.chipColor }}
            >
              {item.chipLabel}
            </span>
            <div className="palette-item-text">
              <div className="palette-item-name">{item.label}</div>
              <div className="palette-item-desc">{item.description}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Module categories ── */}
      {Object.entries(BY_CATEGORY).map(([cat, mods]) => {
        const catDef = CATEGORIES[cat];
        return (
          <div key={cat} className="palette-section">
            <div className="palette-section-header">
              <span className="palette-section-dot" style={{ background: catDef.color }} />
              {catDef.label}
            </div>
            {mods.map((mod) => (
              <div
                key={mod.id}
                className="palette-item"
                draggable
                onDragStart={(e) => onDragStart(e, mod.id)}
                title={mod.description}
              >
                <span
                  className="palette-item-chip"
                  style={{ background: catDef.color + '22', color: catDef.color }}
                >
                  {mod.id.slice(0, 2)}
                </span>
                <div className="palette-item-text">
                  <div className="palette-item-name">{mod.label}</div>
                  <div className="palette-item-desc">{mod.description}</div>
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
