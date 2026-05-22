import { useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { TYPE_COLORS } from '../data/modules';

const FILE_TYPES = new Set([
  'Structure.PDB', 'Structure.mmCIF',
  'Sequence.FASTA', 'Sequence.FASTQ',
]);
const TEXT_TYPES = new Set([
  'Text.RawString', 'Text.Integer', 'Text.Float', 'Text.Score', 'Text.Bool',
]);

function coerce(dataType, raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (dataType === 'Text.Integer') {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  }
  if (dataType === 'Text.Float' || dataType === 'Text.Score') {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
  }
  if (dataType === 'Text.Bool') {
    return raw === 'true' || raw === true;
  }
  return String(raw);
}

export default function InputNode({ id, data, selected }) {
  const { label = 'input', dataType = 'Structure.PDB', filename, path, value } = data;
  const color = TYPE_COLORS[dataType] || '#6b7280';
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const { setNodes } = useReactFlow();

  const isFileType = FILE_TYPES.has(dataType);
  const isTextType = TEXT_TYPES.has(dataType);

  const updateData = (updates) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...updates } } : n))
    );
  };

  const handlePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    updateData({ filename: file.name, path: null });
    try {
      const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const { path: uploadedPath } = await res.json();
      updateData({ filename: file.name, path: uploadedPath });
    } catch (err) {
      setError(err.message ?? 'upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (fileRef.current) fileRef.current.value = '';
    setError(null);
    updateData({ filename: undefined, path: undefined });
  };

  const onTextChange = (raw) => {
    updateData({ value: coerce(dataType, raw) });
  };

  return (
    <div className={`io-node io-node--input${selected ? ' io-node--selected' : ''}`}>
      <div className="io-node-kind">INPUT</div>
      <div className="io-node-type" style={{ color }}>{dataType}</div>
      <div className="io-node-label">&ldquo;{label}&rdquo;</div>

      {isFileType && (
        <div className="io-node-file">
          {filename ? (
            <div className="io-node-file-row" title={path || filename}>
              <span className="io-node-file-name">{filename}</span>
              <button className="io-node-file-clear" onClick={handleClear} title="clear">×</button>
            </div>
          ) : (
            <button
              className="io-node-file-btn"
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
              disabled={uploading}
            >
              {uploading ? 'uploading…' : 'choose file'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handlePick}
          />
          {error && <div className="io-node-file-error" title={error}>upload failed</div>}
        </div>
      )}

      {isTextType && (
        <div className="io-node-text">
          {dataType === 'Text.Bool' ? (
            <select
              className="io-node-text-input nodrag"
              value={value === true ? 'true' : value === false ? 'false' : ''}
              onChange={(e) => onTextChange(e.target.value)}
            >
              <option value="">—</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : dataType === 'Text.RawString' ? (
            <textarea
              className="io-node-text-input nodrag"
              rows={2}
              placeholder="value"
              value={value ?? ''}
              onChange={(e) => onTextChange(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            />
          ) : (
            <input
              className="io-node-text-input nodrag"
              type="number"
              step={dataType === 'Text.Integer' ? 1 : 'any'}
              placeholder={dataType === 'Text.Integer' ? 'int' : 'number'}
              value={value ?? ''}
              onChange={(e) => onTextChange(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="value"
        title={`${label}: ${dataType}`}
        style={{ left: '50%', background: color, width: 9, height: 9, border: '2px solid #0d1117' }}
      />
    </div>
  );
}
