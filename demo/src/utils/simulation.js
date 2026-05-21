const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function topoSort(nodes, edges) {
  const graph = {};
  const inDegree = {};
  for (const n of nodes) { graph[n.id] = []; inDegree[n.id] = 0; }
  for (const e of edges) {
    if (graph[e.source] !== undefined && inDegree[e.target] !== undefined) {
      graph[e.source].push(e.target);
      inDegree[e.target]++;
    }
  }
  const queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
  const result = [];
  while (queue.length) {
    const id = queue.shift();
    result.push(id);
    for (const nb of graph[id]) { if (--inDegree[nb] === 0) queue.push(nb); }
  }
  return result;
}

export async function runSimulation(nodes, edges, onEvent, cancelRef) {
  const sorted = topoSort(nodes, edges);
  onEvent({ type: 'pipeline.start', total: sorted.length });

  for (const nodeId of sorted) {
    if (cancelRef.current) break;

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const mod = node.data.module;

    onEvent({ type: 'node.queued', nodeId });
    await sleep(350 + Math.random() * 250);
    if (cancelRef.current) break;

    onEvent({ type: 'node.running', nodeId });

    const STEPS = 24;
    const stepMs = mod.mockDuration / STEPS;
    const logs = mod.mockLogs || [];

    const logSchedule = logs.map((line, i) => ({
      atStep: Math.floor((i / logs.length) * STEPS),
      line,
    }));
    let logIdx = 0;

    for (let step = 0; step <= STEPS; step++) {
      if (cancelRef.current) break;
      await sleep(stepMs);
      onEvent({ type: 'node.progress', nodeId, current: step, total: STEPS });
      while (logIdx < logSchedule.length && logSchedule[logIdx].atStep <= step) {
        onEvent({ type: 'node.log', nodeId, line: logSchedule[logIdx].line });
        logIdx++;
      }
    }

    if (!cancelRef.current) {
      onEvent({ type: 'node.done', nodeId });
    } else {
      onEvent({ type: 'node.cancelled', nodeId });
    }
  }

  if (!cancelRef.current) onEvent({ type: 'pipeline.done' });
}
