import { MODULES, CONTROL_NODES } from '../data/modules';

// keyword -> control-node id
const CONTROL_KEYWORDS = {
  start_for: 'START_FOR',
  end_for:   'END_FOR',
  save:      'SAVE',
  get:       'GET',
  if_:       'IF',
  compare:   'COMPARE',
  select:    'SELECT',
};

function topoSort(nodes, edges) {
  const graph = {};
  const inDeg = {};
  for (const n of nodes) { graph[n.id] = []; inDeg[n.id] = 0; }
  for (const e of edges) { graph[e.source].push(e.target); inDeg[e.target]++; }
  const q = Object.keys(inDeg).filter((id) => inDeg[id] === 0);
  const out = [];
  while (q.length) {
    const id = q.shift(); out.push(id);
    for (const nb of graph[id]) if (--inDeg[nb] === 0) q.push(nb);
  }
  return out;
}

// Returns "varName" for InputNode sources, "varName.handle" for everything else
function srcRef(srcNode, sourceHandle) {
  if (!srcNode || !srcNode.data) return '???';
  if (srcNode.type === 'input-node') return srcNode.data.varName ?? srcNode.id;
  const vn = srcNode.data.varName ?? srcNode.id;
  return `${vn}.${sourceHandle}`;
}

export function generateDSL(nodes, edges) {
  if (!nodes.length) return '# Drag modules from the palette to begin.\n';

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const incoming = {};
  for (const e of edges) {
    if (!incoming[e.target]) incoming[e.target] = [];
    incoming[e.target].push(e);
  }

  const sorted = topoSort(nodes, edges);
  const hasOutputNodes = nodes.some((n) => n.type === 'output-node');
  const lines = ['# Chaperonin DSL  (auto-generated — edit and Apply to sync)', ''];

  for (const nodeId of sorted) {
    const node = nodeMap[nodeId];
    if (!node) continue;

    if (node.type === 'input-node') {
      const { varName, dataType = 'Structure.PDB', label } = node.data;
      lines.push(`${varName} = input(${dataType}, label="${label || varName}")`);
      continue;
    }

    if (node.type === 'output-node') {
      const inEdge = (incoming[nodeId] || [])[0];
      if (inEdge) {
        const src = nodeMap[inEdge.source];
        lines.push(`output(${srcRef(src, inEdge.sourceHandle)}, name="${node.data.label || nodeId}")`);
      } else {
        lines.push(`# output "${node.data.label || nodeId}" — not connected`);
      }
      continue;
    }

    // Control nodes — emit minimal DSL line using the node's kind/params.
    if (node.type === 'control-node') {
      const { kind, varName = nodeId, params: cparams = {} } = node.data;
      const inEdges = incoming[nodeId] || [];
      const refFor = (handle) => {
        const e = inEdges.find((x) => x.targetHandle === handle);
        if (!e) return '???';
        const src = nodeMap[e.source];
        return srcRef(src, e.sourceHandle);
      };
      const paramStr = Object.entries(cparams)
        .map(([k, v]) => typeof v === 'string' ? `${k}="${v}"` : `${k}=${v}`)
        .join(', ');
      if (kind === 'START_FOR') {
        lines.push(`${varName} = start_for(count=${refFor('count')}${paramStr ? ', ' + paramStr : ''})`);
      } else if (kind === 'END_FOR') {
        lines.push(`${varName} = end_for(paired_start=${refFor('paired_start')}, body_out=${refFor('body_out')})`);
      } else if (kind === 'SAVE') {
        lines.push(`${varName} = save(value=${refFor('value')}${paramStr ? ', ' + paramStr : ''})`);
      } else if (kind === 'GET') {
        lines.push(`${varName} = get(${paramStr})`);
      } else if (kind === 'IF') {
        lines.push(`${varName} = if_(value=${refFor('value')}, condition=${refFor('condition')})`);
      } else if (kind === 'COMPARE') {
        lines.push(`${varName} = compare(a=${refFor('a')}, b=${refFor('b')}${paramStr ? ', ' + paramStr : ''})`);
      } else if (kind === 'SELECT') {
        lines.push(`${varName} = select(from=${refFor('from')}, by=${refFor('by')}${paramStr ? ', ' + paramStr : ''})`);
      } else {
        lines.push(`# unknown control kind: ${kind}`);
      }
      continue;
    }

    const { module: mod, varName, params = {} } = node.data;
    if (!mod) continue;  // malformed node — skip rather than crash
    const inEdges = incoming[nodeId] || [];
    const args = [];

    for (const inp of mod.inputs) {
      const edge = inEdges.find((e) => e.targetHandle === inp.id);
      if (edge) {
        const src = nodeMap[edge.source];
        args.push(`${inp.id}=${srcRef(src, edge.sourceHandle)}`);
      } else {
        args.push(`${inp.id}=???`);
      }
    }

    for (const p of mod.params) {
      const val = params[p.id] !== undefined ? params[p.id] : p.default;
      args.push(typeof val === 'string' ? `${p.id}="${val}"` : `${p.id}=${val}`);
    }

    lines.push(`${varName} = ${mod.id}(${args.join(', ')})`);
  }

  if (!hasOutputNodes) {
    const hasSrc = new Set(edges.map((e) => e.source));
    for (const node of nodes) {
      if (node.type !== 'chaperonin' && node.type !== 'visualizer-node') continue;
      if (!node.data?.module) continue;
      if (!hasSrc.has(node.id)) {
        for (const out of node.data.module.outputs) {
          lines.push(`output(${node.data.varName}.${out.id}, name="${out.id}")`);
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}

function parseArgs(str) {
  const result = {};
  let depth = 0, current = '', key = null;
  const commit = () => {
    const k = key?.trim(), v = current.trim();
    if (k && v) result[k] = v;
    key = null; current = '';
  };
  for (const ch of str) {
    if (ch === '(' || ch === '[') { depth++; current += ch; }
    else if (ch === ')' || ch === ']') { depth--; current += ch; }
    else if (ch === '=' && depth === 0 && key === null) { key = current; current = ''; }
    else if (ch === ',' && depth === 0) { commit(); }
    else current += ch;
  }
  commit();
  return result;
}

export function parseDSL(text, existingNodes) {
  const posMap = Object.fromEntries(existingNodes.map((n) => [n.data?.varName || n.id, n.position]));
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));

  const nodes = [];
  const pendingOutputEdges = [];
  let autoY = 80;

  for (const line of lines) {
    const inMatch = line.match(/^(\w+)\s*=\s*input\(\s*([^,)]+)(?:,\s*label="([^"]*)")?\)/);
    if (inMatch) {
      const [, varName, dataType, label] = inMatch;
      nodes.push({
        id: varName,
        type: 'input-node',
        position: posMap[varName] || { x: 80, y: autoY },
        data: { varName, label: label || varName, dataType: dataType.trim(), status: 'idle' },
      });
      autoY += 140;
      continue;
    }

    const outMatch = line.match(/^output\((\w+)(?:\.(\w+))?,\s*name="([^"]*)"\)/);
    if (outMatch) {
      const [, srcVar, srcHandle, name] = outMatch;
      const varName = `output_${name}`;
      nodes.push({
        id: varName,
        type: 'output-node',
        position: posMap[varName] || { x: 80, y: autoY },
        data: { varName, label: name, inferredType: null, status: 'idle' },
      });
      pendingOutputEdges.push({ srcVar, srcHandle: srcHandle || 'value', outVarName: varName });
      autoY += 140;
      continue;
    }

    const modMatch = line.match(/^(\w+)\s*=\s*(\w+)\s*\(([^)]*)\)/);
    if (!modMatch) continue;
    const [, varName, moduleId, argsStr] = modMatch;

    // ── Control-flow primitives ──
    const ctrlKind = CONTROL_KEYWORDS[moduleId];
    if (ctrlKind) {
      const spec = CONTROL_NODES[ctrlKind];
      const args = parseArgs(argsStr);
      const params = {};
      const inputRefs = {};
      for (const [key, val] of Object.entries(args)) {
        const stripped = val.replace(/^["']|["']$/g, '');
        if (spec.params.find((p) => p.id === key)) {
          params[key] = isNaN(stripped) || stripped === '' ? stripped : Number(stripped);
        } else if (spec.inputs.find((i) => i.id === key)) {
          if (val === '???') continue;
          const dot = val.indexOf('.');
          if (dot === -1) {
            inputRefs[key] = { srcVar: val, srcHandle: 'value' };
          } else {
            inputRefs[key] = { srcVar: val.slice(0, dot), srcHandle: val.slice(dot + 1) };
          }
        }
      }
      nodes.push({
        id: varName,
        type: 'control-node',
        position: posMap[varName] || { x: 220, y: autoY },
        data: { kind: ctrlKind, varName, params, status: 'idle',
                inputs: spec.inputs, outputs: spec.outputs },
      });
      nodes[nodes.length - 1]._inputRefs = inputRefs;
      autoY += 180;
      continue;
    }

    const mod = MODULES[moduleId];
    if (!mod) continue;

    const args = parseArgs(argsStr);
    const params = {};
    const inputRefs = {};

    for (const [key, val] of Object.entries(args)) {
      const stripped = val.replace(/^["']|["']$/g, '');
      if (mod.params.find((p) => p.id === key)) {
        params[key] = isNaN(stripped) || stripped === '' ? stripped : Number(stripped);
      } else if (mod.inputs.find((i) => i.id === key)) {
        if (val === '???') continue;
        const dot = val.indexOf('.');
        if (dot === -1) {
          inputRefs[key] = { srcVar: val, srcHandle: 'value' };
        } else {
          inputRefs[key] = { srcVar: val.slice(0, dot), srcHandle: val.slice(dot + 1) };
        }
      }
    }

    nodes.push({
      id: varName,
      type: moduleId === 'VISUALIZER' ? 'visualizer-node' : 'chaperonin',
      position: posMap[varName] || { x: 220, y: autoY },
      data: { module: mod, varName, params, status: 'idle', progress: null },
    });
    autoY += 220;

    nodes[nodes.length - 1]._inputRefs = inputRefs;
  }

  const edges = [];
  for (const node of nodes) {
    const refs = node._inputRefs || {};
    delete node._inputRefs;
    for (const [inputId, { srcVar, srcHandle }] of Object.entries(refs)) {
      const srcNode = nodes.find((n) => n.data?.varName === srcVar);
      if (!srcNode) continue;
      edges.push({
        id: `${srcNode.id}.${srcHandle}->${node.id}.${inputId}`,
        source: srcNode.id,
        sourceHandle: srcHandle,
        target: node.id,
        targetHandle: inputId,
        animated: false,
        style: { stroke: '#22c55e', strokeWidth: 2 },
      });
    }
  }

  for (const { srcVar, srcHandle, outVarName } of pendingOutputEdges) {
    const srcNode = nodes.find((n) => n.data?.varName === srcVar);
    const outNode = nodes.find((n) => n.id === outVarName);
    if (!srcNode || !outNode) continue;
    edges.push({
      id: `${srcNode.id}.${srcHandle}->${outNode.id}.value`,
      source: srcNode.id,
      sourceHandle: srcHandle,
      target: outNode.id,
      targetHandle: 'value',
      animated: false,
      style: { stroke: '#f59e0b', strokeWidth: 2 },
    });
  }

  return { nodes, edges };
}
