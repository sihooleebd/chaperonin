import { Handle, Position } from 'reactflow';
import { TYPE_COLORS } from '../data/modules';

export default function InputNode({ data, selected }) {
  const { label = 'input', dataType = 'Structure.PDB' } = data;
  const color = TYPE_COLORS[dataType] || '#6b7280';

  return (
    <div className={`io-node io-node--input${selected ? ' io-node--selected' : ''}`}>
      <div className="io-node-kind">INPUT</div>
      <div className="io-node-type" style={{ color }}>{dataType}</div>
      <div className="io-node-label">&ldquo;{label}&rdquo;</div>

      <Handle
        type="source"
        position={Position.Bottom}
        id="value"
        title={`${label}: ${dataType}`}
        style={{
          left: '50%',
          background: color,
          width: 9,
          height: 9,
          border: '2px solid #0d1117',
        }}
      />
    </div>
  );
}
