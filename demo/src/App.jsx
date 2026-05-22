import { useState, useCallback, useRef, useEffect } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  addEdge,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from 'reactflow';

import ChaperonNode    from './components/ChaperonNode.jsx';
import InputNode       from './components/InputNode.jsx';
import OutputNode      from './components/OutputNode.jsx';
import VisualizerNode  from './components/VisualizerNode.jsx';
import ControlNode     from './components/ControlNode.jsx';
import Palette      from './components/Palette.jsx';
import DSLPanel     from './components/DSLPanel.jsx';
import LogPanel     from './components/LogPanel.jsx';

import { MODULES, CATEGORIES, TYPE_COLORS, isCompatible } from './data/modules.js';
import { generateDSL, parseDSL } from './utils/dsl.js';
import { runSimulation } from './utils/simulation.js';

// ── Stable node type map ──────────────────────────────────────
const NODE_TYPES = {
  chaperonin:        ChaperonNode,
  'input-node':      InputNode,
  'output-node':     OutputNode,
  'visualizer-node': VisualizerNode,
  'control-node':    ControlNode,
};

// ── Helper: make edge with type label ────────────────────────
function mkEdge(source, sourceHandle, target, targetHandle, type) {
  const color = TYPE_COLORS[type] || '#6b7280';
  return {
    id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
    source, sourceHandle, target, targetHandle,
    animated: false,
    style: { stroke: color, strokeWidth: 2 },
    label: type,
    labelStyle: { fontSize: 9, fontFamily: 'monospace', fill: color, fontWeight: 600 },
    labelBgStyle: { fill: '#0d1117', fillOpacity: 0.88 },
    labelBgPadding: [4, 7],
    labelBgBorderRadius: 3,
    data: { sourceType: type, compatible: true },
  };
}

function mkNode(id, moduleId, position, params = {}) {
  const mod = MODULES[moduleId];
  return {
    id, type: moduleId === 'VISUALIZER' ? 'visualizer-node' : 'chaperonin', position,
    data: { module: mod, varName: id, params, status: 'idle', progress: null },
  };
}

function mkInputNode(id, position, label, dataType) {
  return {
    id, type: 'input-node', position,
    data: { varName: id, label, dataType, status: 'idle' },
  };
}

function mkOutputNode(id, position, label) {
  return {
    id, type: 'output-node', position,
    data: { varName: id, label, inferredType: null, status: 'idle' },
  };
}

// ── Initial example pipeline ─────────────────────────────────
const INIT_NODES = [
  mkInputNode('scaffold_in',   { x: 200, y: -70  }, 'scaffold',  'Structure.PDB'),
  mkNode('rfdiffusion_1',  'RFDIFFUSION',  { x: 180, y: 90  }, { length: 100, cycle: 50 }),
  mkNode('rosetta_relax_1','ROSETTA_RELAX', { x: 180, y: 320 }, { nstruct: 10 }),
  mkNode('pymol_1',        'PYMOL',         { x: 180, y: 540 }, { style: 'cartoon' }),
  mkOutputNode('render_out', { x: 200, y: 740 }, 'render'),
];

const INIT_EDGES = [
  mkEdge('scaffold_in',   'value',       'rfdiffusion_1',  'pdb_file',  'Structure.PDB'),
  mkEdge('rfdiffusion_1', 'designed_pdb','rosetta_relax_1','structure', 'Structure.PDB'),
  mkEdge('rosetta_relax_1','relaxed',    'pymol_1',        'structure', 'Structure.PDB'),
  mkEdge('pymol_1',       'rendered',    'render_out',     'value',     'Visual.PNG'),
];

const INIT_COUNTERS = { rfdiffusion: 1, rosetta_relax: 1, pymol: 1, 'input-node': 0, 'output-node': 1 };

// ── App ──────────────────────────────────────────────────────
export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INIT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INIT_EDGES);
  const [isRunning, setIsRunning]   = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [dslText, setDslText]       = useState('');
  const [dslDirty, setDslDirty]     = useState(false);
  const [logs, setLogs]             = useState([]);
  const [logOpen, setLogOpen]       = useState(false);
  const [toasts, setToasts]         = useState([]);
  const [ctxMenu, setCtxMenu]       = useState(null); // { kind, id, label, x, y }

  const rfWrapper  = useRef(null);
  const rfInstance = useRef(null);
  const cancelRef  = useRef(false);
  const idCounters = useRef({ ...INIT_COUNTERS });

  // ── Auto-generate DSL when canvas changes ────────────────────
  useEffect(() => {
    if (!dslDirty) setDslText(generateDSL(nodes, edges));
  }, [nodes, edges, dslDirty]);

  // ── Keep selectedNode props in sync with node state ──────────
  useEffect(() => {
    if (!selectedNode) return;
    const updated = nodes.find((n) => n.id === selectedNode.id);
    if (updated) setSelectedNode(updated);
  }, [nodes]);

  // ── Toast ────────────────────────────────────────────────────
  const toast = useCallback((msg, kind = 'info', ms = 3000) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  // ── Node status helper ───────────────────────────────────────
  const setNodeStatus = useCallback((nodeId, status, progress = null) => {
    setNodes((nds) =>
      nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, status, progress } } : n)
    );
  }, [setNodes]);

  const resetStatuses = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: 'idle', progress: null } })));
  }, [setNodes]);

  // ── Pipeline validation ──────────────────────────────────────
  const validatePipeline = useCallback(() => {
    const missing = [];
    const typeErrors = [];

    for (const node of nodes) {
      if (node.type !== 'chaperonin') continue;
      for (const inp of node.data.module.inputs) {
        const connected = edges.find(
          (e) => e.target === node.id && e.targetHandle === inp.id
        );
        if (!connected) {
          missing.push(`${node.data.varName}.${inp.id} (${inp.type})`);
        } else if (connected.data && !connected.data.compatible) {
          typeErrors.push(`${node.data.varName}.${inp.id}: type mismatch`);
        }
      }
    }

    // Mark nodes with missing inputs so the canvas shows them
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== 'chaperonin') return n;
        const missingInputs = n.data.module.inputs
          .filter((inp) => !edges.find((e) => e.target === n.id && e.targetHandle === inp.id))
          .map((inp) => inp.id);
        const typeErrInputs = n.data.module.inputs
          .filter((inp) => {
            const e = edges.find((e) => e.target === n.id && e.targetHandle === inp.id);
            return e && e.data && !e.data.compatible;
          })
          .map((inp) => inp.id);
        return { ...n, data: { ...n.data, missingInputs, typeErrInputs } };
      })
    );

    return { missing, typeErrors };
  }, [nodes, edges, setNodes]);

  // ── Run / Stop ───────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (nodes.length === 0) { toast('Add some modules first.', 'warn'); return; }

    const { missing, typeErrors } = validatePipeline();
    if (missing.length > 0) {
      toast(
        `Cannot run — ${missing.length} unconnected input${missing.length > 1 ? 's' : ''}:\n` +
        missing.map((m) => `  • ${m}`).join('\n'),
        'error', 6000
      );
      return;
    }
    if (typeErrors.length > 0) {
      toast(
        `Cannot run — ${typeErrors.length} type error${typeErrors.length > 1 ? 's' : ''}:\n` +
        typeErrors.map((m) => `  • ${m}`).join('\n'),
        'error', 6000
      );
      return;
    }
    cancelRef.current = false;
    setIsRunning(true);
    setLogs([]);
    setLogOpen(true);
    // Clear validation errors and reset statuses
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: 'idle', progress: null, validationError: null } })));

    const addLog = (e) => setLogs((l) => [...l, { ...e, ts: Date.now() }]);

    // Only simulate compute nodes (not IO)
    const computeNodes = nodes.filter((n) => n.type === 'chaperonin');
    const computeEdges = edges; // keep full edge set for topo order

    await runSimulation(computeNodes, computeEdges, (event) => {
      addLog(event);
      if (event.type === 'node.queued')   setNodeStatus(event.nodeId, 'queued');
      if (event.type === 'node.running')  setNodeStatus(event.nodeId, 'running');
      if (event.type === 'node.progress') setNodeStatus(event.nodeId, 'running', { current: event.current, total: event.total });
      if (event.type === 'node.done')     setNodeStatus(event.nodeId, 'done');
      if (event.type === 'node.cancelled')setNodeStatus(event.nodeId, 'idle');
      if (event.type === 'pipeline.done') {
        // Mark IO nodes as done when pipeline completes
        setNodes((nds) =>
          nds.map((n) =>
            (n.type === 'input-node' || n.type === 'output-node')
              ? { ...n, data: { ...n.data, status: 'done' } }
              : n
          )
        );
      }
    }, cancelRef);

    setIsRunning(false);
  }, [nodes, edges, setNodeStatus, resetStatuses, toast, setNodes]);

  const handleStop = useCallback(() => {
    cancelRef.current = true;
    setIsRunning(false);
    toast('Pipeline cancelled.', 'warn');
  }, [toast]);

  // ── DnD ──────────────────────────────────────────────────────
  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('application/chaperonin');
    if (!id || !rfInstance.current || !rfWrapper.current) return;

    const bounds = rfWrapper.current.getBoundingClientRect();
    const position = rfInstance.current.project({
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top,
    });

    let newNode;

    if (id === 'input-node') {
      idCounters.current['input-node'] = (idCounters.current['input-node'] || 0) + 1;
      const n = idCounters.current['input-node'];
      const varName = `input_${n}`;
      newNode = { id: varName, type: 'input-node', position,
        data: { varName, label: `input_${n}`, dataType: 'Structure.PDB', status: 'idle' } };

    } else if (id === 'output-node') {
      idCounters.current['output-node'] = (idCounters.current['output-node'] || 0) + 1;
      const n = idCounters.current['output-node'];
      const varName = `output_${n}`;
      newNode = { id: varName, type: 'output-node', position,
        data: { varName, label: `output_${n}`, inferredType: null, status: 'idle' } };

    } else {
      const mod = MODULES[id];
      if (!mod) return;
      const key = id.toLowerCase();
      idCounters.current[key] = (idCounters.current[key] || 0) + 1;
      const varName = `${key}_${idCounters.current[key]}`;
      const defaultParams = Object.fromEntries(mod.params.map((p) => [p.id, p.default]));
      const visualType = id === 'VISUALIZER' ? 'visualizer-node' : 'chaperonin';
      newNode = { id: varName, type: visualType, position,
        data: { module: mod, varName, params: defaultParams, status: 'idle', progress: null } };
    }

    setNodes((nds) => [...nds, newNode]);
    setDslDirty(false);
  }, [setNodes]);

  // ── Connect — with type label + single-input enforcement ─────
  const onConnect = useCallback((params) => {
    const srcNode = nodes.find((n) => n.id === params.source);
    const tgtNode = nodes.find((n) => n.id === params.target);
    if (!srcNode || !tgtNode) return;

    // Determine source output type
    let srcType;
    if (srcNode.type === 'input-node') {
      srcType = srcNode.data.dataType;
    } else {
      srcType = srcNode.data.module?.outputs?.find((o) => o.id === params.sourceHandle)?.type;
    }

    // Determine target input type (null = accepts anything, e.g. OutputNode)
    let tgtType;
    if (tgtNode.type !== 'output-node') {
      tgtType = tgtNode.data.module?.inputs?.find((i) => i.id === params.targetHandle)?.type;
    }

    const compatible = tgtType ? isCompatible(srcType, tgtType) : true;
    if (!compatible) {
      toast(`Type mismatch: ${srcType} → ${tgtType}. Edge added but marked invalid.`, 'error', 5000);
    }

    const color = TYPE_COLORS[srcType] || '#6b7280';

    const newEdge = {
      id: `${params.source}.${params.sourceHandle}->${params.target}.${params.targetHandle}`,
      ...params,
      animated: false,
      className: compatible ? '' : 'edge-type-error',
      style: { stroke: compatible ? color : '#ef4444', strokeWidth: 2,
               strokeDasharray: compatible ? undefined : '5 3' },
      // ── Type label on the wire ──
      label: srcType || '',
      labelStyle: { fontSize: 9, fontFamily: 'monospace',
                    fill: compatible ? color : '#ef4444', fontWeight: 600 },
      labelBgStyle: { fill: '#0d1117', fillOpacity: 0.88 },
      labelBgPadding: [4, 7],
      labelBgBorderRadius: 3,
      data: { sourceType: srcType, targetType: tgtType, compatible },
    };

    // ── Overwrite any existing edge going to the same input handle ──
    setEdges((eds) => {
      const filtered = eds.filter(
        (e) => !(e.target === params.target && e.targetHandle === params.targetHandle)
      );
      return addEdge(newEdge, filtered);
    });

    // ── Propagate inferred type to OutputNode ──
    if (tgtNode.type === 'output-node' && srcType) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === tgtNode.id ? { ...n, data: { ...n.data, inferredType: srcType } } : n
        )
      );
    }
  }, [nodes, setEdges, setNodes, toast]);

  // ── Clear / Load example ──────────────────────────────────────
  const handleClear = useCallback(() => {
    if (!window.confirm('Clear the canvas?')) return;
    setNodes([]); setEdges([]);
    setSelectedNode(null);
    idCounters.current = { ...INIT_COUNTERS, 'input-node': 0, 'output-node': 0 };
    setDslDirty(false);
  }, [setNodes, setEdges]);

  const handleLoadExample = useCallback(() => {
    setNodes(INIT_NODES); setEdges(INIT_EDGES);
    setSelectedNode(null);
    idCounters.current = { ...INIT_COUNTERS };
    resetStatuses();
    setDslDirty(false);
  }, [setNodes, setEdges, resetStatuses]);

  // ── DSL ───────────────────────────────────────────────────────
  const onDslChange = useCallback((val) => { setDslText(val); setDslDirty(true); }, []);

  const onApplyDsl = useCallback(() => {
    try {
      const { nodes: newNodes, edges: newEdges } = parseDSL(dslText, nodes);
      if (!newNodes.length) { toast('No valid statements found.', 'warn'); return; }
      setNodes(newNodes); setEdges(newEdges);
      setSelectedNode(null); setDslDirty(false);
      toast(`Applied: ${newNodes.length} nodes, ${newEdges.length} edges.`, 'info');
    } catch (err) {
      toast(`Parse error: ${err.message}`, 'error', 6000);
    }
  }, [dslText, nodes, setNodes, setEdges, toast]);

  // ── Generic node data change (params + IO node fields) ────────
  const onNodeDataChange = useCallback((nodeId, updates) => {
    setNodes((nds) =>
      nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)
    );
    setDslDirty(false); // let DSL re-gen pick up the change
  }, [setNodes]);

  // Param change is a subset of onNodeDataChange
  const onParamChange = useCallback((nodeId, paramId, value) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, params: { ...n.data.params, [paramId]: value } } }
          : n
      )
    );
    setDslDirty(false);
  }, [setNodes]);

  // ── Delete node or edge ───────────────────────────────────────
  const deleteNode = useCallback((nodeId) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode((sel) => (sel?.id === nodeId ? null : sel));
    setCtxMenu(null);
  }, [setNodes, setEdges]);

  const deleteEdge = useCallback((edgeId) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    setCtxMenu(null);
  }, [setEdges]);

  // ── Context menu ─────────────────────────────────────────────
  const onNodeContextMenu = useCallback((e, node) => {
    e.preventDefault();
    setCtxMenu({ kind: 'node', id: node.id, label: node.data.varName || node.id, x: e.clientX, y: e.clientY });
  }, []);

  const onEdgeContextMenu = useCallback((e, edge) => {
    e.preventDefault();
    const label = edge.data?.sourceType ? `${edge.data.sourceType} wire` : 'connection';
    setCtxMenu({ kind: 'edge', id: edge.id, label, x: e.clientX, y: e.clientY });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const onNodeClick  = useCallback((_, n) => { setSelectedNode(n); setCtxMenu(null); }, []);
  const onPaneClick  = useCallback(() => { setSelectedNode(null); setCtxMenu(null); }, []);

  // ── Stats ─────────────────────────────────────────────────────
  const typeErrors = edges.filter((e) => e.data && !e.data.compatible).length;
  const doneCount  = nodes.filter((n) => n.data.status === 'done').length;

  return (
    <div className="app">
      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="toolbar-logo">
          <span>Chaperonin</span>
          <span className="toolbar-logo-accent">●</span>
          <span className="toolbar-logo-sub">v0.1 prototype</span>
        </div>

        <div className="toolbar-sep" />

        {nodes.length > 0 && (
          <span className="toolbar-stat">
            <strong>{nodes.length}</strong> nodes &nbsp;
            <strong>{edges.length}</strong> edges
            {typeErrors > 0 && (
              <span style={{ color: '#ef4444', marginLeft: 8 }}>
                ⚠ {typeErrors} type error{typeErrors > 1 ? 's' : ''}
              </span>
            )}
            {doneCount > 0 && !isRunning && (
              <span style={{ color: '#10b981', marginLeft: 8 }}>
                ✓ {doneCount}/{nodes.length} done
              </span>
            )}
          </span>
        )}

        <button className="btn" onClick={handleLoadExample} disabled={isRunning}>Load Example</button>
        <button className="btn" onClick={handleClear} disabled={isRunning}>Clear</button>

        {isRunning ? (
          <button className="btn btn-stop" onClick={handleStop}>■ Stop</button>
        ) : (
          <button className="btn btn-run" onClick={handleRun} disabled={nodes.length === 0}>
            ▶ Run Pipeline
          </button>
        )}
      </div>

      {/* ── Main ── */}
      <div className="main">
        <Palette />

        <div className="canvas-wrapper" ref={rfWrapper} onDrop={onDrop} onDragOver={onDragOver}>
          {nodes.length === 0 && (
            <div className="canvas-empty">
              <div className="canvas-empty-icon">⬡</div>
              <div className="canvas-empty-text">
                Drag modules from the palette<br />
                or click <strong>Load Example</strong>
              </div>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => { rfInstance.current = inst; }}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            deleteKeyCode={['Delete', 'Backspace']}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2535" />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                if (n.type === 'input-node')  return '#10b981';
                if (n.type === 'output-node') return '#f59e0b';
                const cat = n.data?.module?.category;
                return cat ? (CATEGORIES[cat]?.color || '#334155') : '#334155';
              }}
              maskColor="rgba(13,17,23,0.75)"
            />
          </ReactFlow>
        </div>

        <DSLPanel
          dslText={dslText}
          dslDirty={dslDirty}
          onDslChange={onDslChange}
          onApplyDsl={onApplyDsl}
          selectedNode={selectedNode}
          onParamChange={onParamChange}
          onNodeDataChange={onNodeDataChange}
        />
      </div>

      <LogPanel logs={logs} open={logOpen} onToggle={() => setLogOpen((v) => !v)} />

      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>{t.msg}</div>
        ))}
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onClick={closeCtxMenu} />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <div className="ctx-menu-label">{ctxMenu.label}</div>
            <button
              className="ctx-menu-item ctx-menu-item--danger"
              onClick={() =>
                ctxMenu.kind === 'node' ? deleteNode(ctxMenu.id) : deleteEdge(ctxMenu.id)
              }
            >
              Delete {ctxMenu.kind === 'node' ? 'node' : 'connection'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
