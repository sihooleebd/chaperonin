import { useEffect, useRef, useState } from 'react';
import { Handle, Position } from 'reactflow';

const ACCENT = '#f59e0b';
const TMOL_CDNS = [
  'https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/3Dmol-min.js',
  'https://unpkg.com/3dmol@2.4.2/build/3Dmol-min.js',
  'https://3Dmol.org/build/3Dmol-min.js',
];

let _loadPromise = null;
function ensure3Dmol() {
  if (window.$3Dmol) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  _loadPromise = TMOL_CDNS.reduce((acc, url) =>
    acc.catch(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => window.$3Dmol ? resolve() : reject(new Error('loaded but $3Dmol missing'));
      s.onerror = () => reject(new Error(`failed: ${url}`));
      document.head.appendChild(s);
    })),
    Promise.reject(new Error('init'))
  );
  return _loadPromise;
}

function kindFromUrl(url) {
  if (!url) return null;
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image';
  if (path.endsWith('.pdb') || path.endsWith('.cif') || path.endsWith('.mmcif')) return 'pdb';
  if (path.endsWith('.wrl') || path.endsWith('.x3d')) return 'web3d';
  return 'unknown';
}

function PdbViewer({ url }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    ensure3Dmol()
      .then(() => fetch(url))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
        return r.text();
      })
      .then((pdb) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = '';
        const viewer = window.$3Dmol.createViewer(ref.current, {
          backgroundColor: '#0d1117',
        });
        viewer.addModel(pdb, 'pdb');
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
        viewer.zoomTo();
        viewer.render();
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e.message || e));
      });
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="visualizer-node-placeholder" style={{ color: '#ef4444' }}>
        3D viewer error:<br /><code style={{ fontSize: 9 }}>{error}</code>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="visualizer-node-3d"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    />
  );
}

export default function VisualizerNode({ data, selected }) {
  const url = data.displayUrl || null;
  const kind = kindFromUrl(url);
  const [imgError, setImgError] = useState(false);

  useEffect(() => { setImgError(false); }, [url]);

  let body;
  if (!url) {
    body = (
      <div className="visualizer-node-placeholder">
        Output will appear here<br />after the pipeline completes
        {data.status === 'done' && (
          <><br /><span style={{ color: '#ef4444', fontSize: 10 }}>
            (status=done but upstream output URL not resolved — hard-refresh)
          </span></>
        )}
      </div>
    );
  } else if (kind === 'image') {
    body = imgError ? (
      <div className="visualizer-node-placeholder" style={{ color: '#ef4444' }}>
        Image failed to load.<br />
        <code style={{ fontSize: 9, wordBreak: 'break-all' }}>{url}</code>
      </div>
    ) : (
      <img
        src={url}
        alt="rendered"
        className="visualizer-node-img"
        onError={() => setImgError(true)}
      />
    );
  } else if (kind === 'pdb') {
    body = <PdbViewer url={url} />;
  } else if (kind === 'web3d') {
    body = (
      <div className="visualizer-node-placeholder">
        3D scene file (VRML).<br />Browser preview not available inline.<br />
        <a href={url} download className="visualizer-node-download">⬇ download .wrl</a>
      </div>
    );
  } else {
    body = (
      <div className="visualizer-node-placeholder" style={{ color: '#ef4444' }}>
        Unknown output kind:<br /><code style={{ fontSize: 9 }}>{url}</code>
      </div>
    );
  }

  return (
    <div className={`visualizer-node${selected ? ' visualizer-node--selected' : ''}`}>
      <Handle
        type="target" position={Position.Top} id="value"
        title="value: PNG / PDB / VRML"
        style={{ left: '50%', background: ACCENT, width: 11, height: 11, border: '2px solid #0d1117' }}
      />

      <div className="visualizer-node-title">
        <span>VISUALIZER</span>
        <span className="visualizer-node-kind">{kind || '—'}</span>
        <span className="visualizer-node-status">{data.status || 'idle'}</span>
      </div>

      <div className="visualizer-node-preview">{body}</div>

      {url && (
        <div className="visualizer-node-link-row">
          <a href={url} download className="visualizer-node-download" title={url}>
            ⬇ download
          </a>
        </div>
      )}
    </div>
  );
}
