/**
 * Serialize the ReactFlow canvas state into the JSON payload that the Python
 * orchestrator backend expects to receive with a "run" message.
 *
 * PipelinePayload shape (also defined in backend.js protocol comment):
 * {
 *   nodes:    { id, module_id, params, inputs: [id,...], outputs: [{id,type},...] }[]
 *   io_nodes: { id, type, var_name, label, data_type }[]
 *   edges:    { source, source_handle, target, target_handle, data_type }[]
 *   dsl:      string   — the auto-generated DSL text
 * }
 */
export function serializePipeline(nodes, edges, dsl) {
  const computeNodes = nodes
    .filter((n) => n.type === 'chaperonin')
    .map((n) => ({
      id:        n.id,
      module_id: n.data.module.id,
      params:    { ...n.data.params },
      inputs:    n.data.module.inputs.map((i) => i.id),
      outputs:   n.data.module.outputs.map((o) => ({ id: o.id, type: o.type })),
    }));

  const ioNodes = nodes
    .filter((n) => n.type === 'input-node' || n.type === 'output-node')
    .map((n) => ({
      id:        n.id,
      type:      n.type,
      var_name:  n.data.varName,
      label:     n.data.label,
      data_type: n.data.dataType ?? n.data.inferredType ?? null,
    }));

  const serializedEdges = edges.map((e) => ({
    source:        e.source,
    source_handle: e.sourceHandle,
    target:        e.target,
    target_handle: e.targetHandle,
    data_type:     e.data?.sourceType ?? null,
  }));

  return { nodes: computeNodes, io_nodes: ioNodes, edges: serializedEdges, dsl };
}
