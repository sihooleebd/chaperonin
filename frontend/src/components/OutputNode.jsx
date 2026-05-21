import { Handle, Position } from 'reactflow';
import { TYPE_COLORS } from '../data/modules';

export default function OutputNode({ data, selected }) {
  const { label = 'output', inferredType } = data;
  const color = inferredType ? (TYPE_COLORS[inferredType] || '#6b7280') : '#4a5568';

  return (
    <div className={`io-node io-node--output${selected ? ' io-node--selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Top}
        id="value"
        title={inferredType ? `${label}: ${inferredType}` : label}
        style={{ left: '50%', background: color, width: 9, height: 9, border: '2px solid #0d1117' }}
      />

      <div className="io-node-kind">OUTPUT</div>
      <div className="io-node-label">&ldquo;{label}&rdquo;</div>
      {inferredType && <div className="io-node-type" style={{ color }}>{inferredType}</div>}
    </div>
  );
}
