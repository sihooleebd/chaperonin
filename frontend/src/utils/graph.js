/**
 * Serialize the ReactFlow canvas state into the JSON payload the Python
 * orchestrator backend expects with a "run" message.
 */
export function serializePipeline(nodes, edges, dsl) {
  const computeNodes = nodes
    .filter((n) => (n.type === 'chaperonin' || n.type === 'visualizer-node') && n.data?.module)
    .map((n) => ({
      id:        n.id,
      module_id: n.data.module.id,
      params:    { ...n.data.params },
      inputs:    n.data.module.inputs.map((i) => i.id),
      outputs:   n.data.module.outputs.map((o) => ({ id: o.id, type: o.type })),
    }));

  const controlNodes = nodes
    .filter((n) => n.type === 'control-node')
    .map((n) => ({
      id:      n.id,
      kind:    n.data.kind,
      params:  { ...(n.data.params || {}) },
      inputs:  n.data.inputs  || [],
      outputs: n.data.outputs || [],
    }));

  const ioNodes = nodes
    .filter((n) => n.type === 'input-node' || n.type === 'output-node')
    .map((n) => ({
      id:        n.id,
      type:      n.type,
      var_name:  n.data.varName,
      label:     n.data.label,
      data_type: n.data.dataType ?? n.data.inferredType ?? null,
      path:      n.data.path  ?? null,
      value:     n.data.value ?? null,
    }));

  const serializedEdges = edges.map((e) => ({
    source:        e.source,
    source_handle: e.sourceHandle,
    target:        e.target,
    target_handle: e.targetHandle,
    data_type:     e.data?.sourceType ?? null,
  }));

  return {
    nodes: computeNodes,
    control_nodes: controlNodes,
    io_nodes: ioNodes,
    edges: serializedEdges,
    dsl,
  };
}
