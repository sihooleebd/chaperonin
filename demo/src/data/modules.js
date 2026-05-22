export const CATEGORIES = {
  design:        { label: 'Design',        color: '#8b5cf6' },
  prediction:    { label: 'Prediction',    color: '#0ea5e9' },
  refinement:    { label: 'Refinement',    color: '#10b981' },
  visualization: { label: 'Visualization', color: '#f59e0b' },
  converter:     { label: 'Converter',     color: '#6b7280' },
};

export const TYPE_COLORS = {
  'Structure':       '#22c55e',
  'Structure.PDB':   '#16a34a',
  'Structure.mmCIF': '#15803d',
  'Sequence':        '#f59e0b',
  'Sequence.FASTA':  '#d97706',
  'Sequence.FASTQ':  '#b45309',
  'Visual':          '#ec4899',
  'Visual.PNG':      '#db2777',
  'Visual.Web3D':    '#be185d',
  'Text':            '#94a3b8',
  'Text.RawString':  '#64748b',
  'Text.Integer':    '#475569',
  'Text.Float':      '#334155',
  'Text.Score':      '#a3e635',
  'Text.Bool':       '#22d3ee',
  'List':            '#0ea5e9',
  'List.Structure':       '#22c55e',
  'List.Structure.PDB':   '#16a34a',
  'List.Sequence.FASTA':  '#d97706',
  'List.Text.RawString':  '#64748b',
  'List.Text.Integer':    '#475569',
  'List.Text.Float':      '#334155',
  'List.Text.Score':      '#a3e635',
  'List.Text.Bool':       '#22d3ee',
  '*':                    '#94a3b8',
};

// Returns true if outputType can feed inputType
export function isCompatible(outputType, inputType) {
  if (!outputType || !inputType) return false;
  if (outputType === '*' || inputType === '*') return true;
  if (outputType === inputType) return true;
  if (inputType.includes('|')) {
    return inputType.split('|').some((t) => isCompatible(outputType, t.trim()));
  }
  const outIsList = outputType.startsWith('List.');
  const inIsList = inputType.startsWith('List.');
  if (outIsList !== inIsList) return false;
  if (outIsList && inIsList) {
    return isCompatible(outputType.slice(5), inputType.slice(5));
  }
  // Parent accepts child: Input[Structure] accepts Structure.PDB
  if (outputType.startsWith(inputType + '.')) return true;
  // Union types (legacy fallback path below — kept for any other unions)
  if (inputType.includes('|')) {
    return inputType.split('|').some(t => isCompatible(outputType, t.trim()));
  }
  return false;
}

export const MODULES = {
  RFDIFFUSION: {
    id: 'RFDIFFUSION',
    label: 'RFDiffusion',
    category: 'design',
    description: 'Backbone design via diffusion (CPU; very slow on arm64)',
    resources: { gpu: 0, memory_gb: 16 },
    retention: 'permanent',
    inputs: [
      { id: 'pdb_file', type: 'Structure.PDB' },
    ],
    params: [
      { id: 'contigs',     type: 'Text.RawString', default: '50-100' },
      { id: 'hotspot_res', type: 'Text.RawString', default: ''       },
      { id: 'num_designs', type: 'Text.Integer',   default: 1        },
    ],
    outputs: [
      { id: 'designed_pdb', type: 'Structure.PDB' },
    ],
    mockDuration: 7000,
    mockLogs: [
      'Loading model weights (rfdiffusion:1.5.0)...',
      'Reading input scaffold...',
      'Initializing diffusion process...',
      '[1/50]  loss=2.341  pLDDT=0.41',
      '[10/50] loss=1.892  pLDDT=0.58',
      '[20/50] loss=1.512  pLDDT=0.67',
      '[30/50] loss=1.201  pLDDT=0.74',
      '[40/50] loss=0.991  pLDDT=0.79',
      '[50/50] loss=0.832  pLDDT=0.84',
      'Writing designed.pdb...',
      'Done. Chains: 1, Residues: 100',
    ],
    mockMetrics: [
      { key: 'pLDDT', values: [0.41, 0.58, 0.67, 0.74, 0.79, 0.84] },
    ],
  },

  ALPHAFOLD: {
    id: 'ALPHAFOLD',
    label: 'AlphaFold',
    category: 'prediction',
    description: 'Structure prediction from sequence (ColabFold; CPU mode, remote MSA)',
    resources: { gpu: 0, memory_gb: 16 },
    retention: 'permanent',
    inputs: [
      { id: 'sequence', type: 'Sequence.FASTA' },
    ],
    params: [],
    outputs: [
      { id: 'structure', type: 'Structure.PDB' },
    ],
    mockDuration: 9000,
    mockLogs: [
      'Running MSA search (UniRef90)...',
      'Running MSA search (BFD)...',
      'Building feature dict...',
      'Running model_1 of 5...',
      'model_1 pLDDT: 0.71',
      'Running model_2 of 5...',
      'model_2 pLDDT: 0.83',
      'Running model_3 of 5...',
      'model_3 pLDDT: 0.79',
      'Selecting best model: model_2',
      'Writing structure.pdb...',
      'Done. Mean pLDDT: 0.82',
    ],
  },

  ROSETTAFOLD: {
    id: 'ROSETTAFOLD',
    label: 'RoseTTAFold',
    category: 'prediction',
    description: 'Structure prediction (RoseTTAFold)',
    resources: { gpu: 1, memory_gb: 32 },
    retention: 'permanent',
    inputs: [
      { id: 'sequence', type: 'Sequence.FASTA' },
    ],
    params: [],
    outputs: [
      { id: 'structure', type: 'Structure.PDB' },
      { id: 'score',     type: 'Text.Score' },
    ],
    mockDuration: 6000,
    mockLogs: [
      'Loading RoseTTAFold weights...',
      'MSA search...',
      'Predicting structure (2-track)...',
      'TM-score estimate: 0.71',
      'Score: -342.1',
      'Writing structure.pdb...',
      'Done.',
    ],
  },

  ROSETTA_RELAX: {
    id: 'ROSETTA_RELAX',
    label: 'Rosetta Relax',
    category: 'refinement',
    description: 'Energy minimization',
    resources: { gpu: 0, memory_gb: 8, cpu_cores: 8 },
    retention: 'standard',
    inputs: [
      { id: 'structure', type: 'Structure.PDB' },
    ],
    params: [
      { id: 'nstruct', type: 'Text.Integer', default: 10 },
    ],
    outputs: [
      { id: 'relaxed', type: 'Structure.PDB' },
      { id: 'score',   type: 'Text.Score' },
    ],
    mockDuration: 4000,
    mockLogs: [
      'Initializing Rosetta...',
      'Loading PDB (342 residues)...',
      'FastRelax protocol (10 structs)...',
      'struct 1: score=-412.3',
      'struct 4: score=-421.1',
      'struct 7: score=-428.3',
      'Best score: -428.3 (struct 7)',
      'Writing relaxed.pdb...',
      'Done.',
    ],
  },

  PYMOL: {
    id: 'PYMOL',
    label: 'PyMOL',
    category: 'visualization',
    description: 'Molecular visualization',
    resources: { gpu: 0, memory_gb: 4 },
    retention: 'ephemeral',
    inputs: [
      { id: 'structure', type: 'Structure.PDB' },
    ],
    params: [
      { id: 'style', type: 'Text.RawString', default: 'cartoon' },
    ],
    outputs: [
      { id: 'rendered', type: 'Visual.PNG'   },
      { id: 'scene',    type: 'Structure.PDB' },
    ],
    mockDuration: 1800,
    mockLogs: [
      'Loading structure into PyMOL...',
      'Applying cartoon style...',
      'Coloring by secondary structure...',
      'Rendering PNG (1920x1080)...',
      'Exporting Web3D scene...',
      'Done.',
    ],
  },

  VISUALIZER: {
    id: 'VISUALIZER',
    label: 'Visualizer',
    category: 'visualization',
    description: 'Render a PNG, PDB, or 3D scene inline in the canvas (sink)',
    resources: { gpu: 0, memory_gb: 1 },
    retention: 'ephemeral',
    inputs: [
      { id: 'value', type: 'Visual.PNG | Visual.Web3D | Structure.PDB' },
    ],
    params: [],
    outputs: [],
    mockDuration: 300,
    mockLogs: [
      'Receiving content...',
      'Ready for inline display.',
    ],
  },

  PDB_TO_FASTA: {
    id: 'PDB_TO_FASTA',
    label: 'PDB → FASTA',
    category: 'converter',
    description: 'Extract sequence from structure',
    resources: { gpu: 0, memory_gb: 1 },
    retention: 'ephemeral',
    inputs: [
      { id: 'pdb', type: 'Structure.PDB' },
    ],
    params: [],
    outputs: [
      { id: 'fasta', type: 'Sequence.FASTA' },
    ],
    mockDuration: 400,
    mockLogs: [
      'Reading PDB chains...',
      'Extracted 342 residues from chain A.',
      'Writing sequence.fasta...',
      'Done.',
    ],
  },
};

// Handle position helper: distribute n handles evenly across 0-100%
export function handleLeft(index, total) {
  return `${((index + 0.5) / total) * 100}%`;
}

export const CONTROL_CATEGORIES = {
  control:  { label: 'Control',  color: '#f97316' },
  variable: { label: 'Variable', color: '#a855f7' },
  utility:  { label: 'Utility',  color: '#94a3b8' },
};

export const CONTROL_NODES = {
  START_FOR: {
    id: 'START_FOR', label: 'Start For', kind: 'control', category: 'control',
    description: 'Begin a counted loop',
    inputs:  [{ id: 'count', type: 'Text.Integer' }],
    outputs: [{ id: 'iter', type: 'Text.Integer' }, { id: 'gate', type: '*' }],
    params:  [{ id: 'loop_label', type: 'Text.RawString', default: 'loop' }],
  },
  END_FOR: {
    id: 'END_FOR', label: 'End For', kind: 'control', category: 'control',
    description: 'Close a loop; results = List<body_out>',
    inputs:  [{ id: 'paired_start', type: '*' }, { id: 'body_out', type: '*' }],
    outputs: [{ id: 'results', type: '*' }],
    params:  [],
  },
  SAVE: {
    id: 'SAVE', label: 'Save', kind: 'variable', category: 'variable',
    description: 'Store value into a named variable',
    inputs:  [{ id: 'value', type: '*' }],
    outputs: [{ id: 'value', type: '*' }],
    params:  [{ id: 'name', type: 'Text.RawString', default: 'var' }],
  },
  GET: {
    id: 'GET', label: 'Get', kind: 'variable', category: 'variable',
    description: 'Read a named variable from the active scope',
    inputs:  [],
    outputs: [{ id: 'value', type: '*' }],
    params:  [{ id: 'name', type: 'Text.RawString', default: 'var' }],
  },
  IF: {
    id: 'IF', label: 'If', kind: 'control', category: 'control',
    description: 'Forward value to if_true or if_false based on condition',
    inputs:  [{ id: 'value', type: '*' }, { id: 'condition', type: 'Text.Bool' }],
    outputs: [{ id: 'if_true', type: '*' }, { id: 'if_false', type: '*' }],
    params:  [],
  },
  COMPARE: {
    id: 'COMPARE', label: 'Compare', kind: 'utility', category: 'utility',
    description: 'Compare two numbers; result is Text.Bool',
    inputs: [
      { id: 'a', type: 'Text.Integer | Text.Float | Text.Score' },
      { id: 'b', type: 'Text.Integer | Text.Float | Text.Score' },
    ],
    outputs: [{ id: 'result', type: 'Text.Bool' }],
    params:  [{ id: 'op', type: 'Text.RawString', default: 'lt',
                choices: ['lt', 'le', 'eq', 'ne', 'ge', 'gt'] }],
  },
  SELECT: {
    id: 'SELECT', label: 'Select', kind: 'utility', category: 'utility',
    description: 'Pick one item from a list by parallel-list scoring',
    inputs: [
      { id: 'from', type: '*' },
      { id: 'by', type: 'List.Text.Float | List.Text.Integer | List.Text.Score' },
    ],
    outputs: [{ id: 'value', type: '*' }],
    params:  [{ id: 'mode', type: 'Text.RawString', default: 'min',
                choices: ['min', 'max', 'first', 'last'] }],
  },
};

// Selectable types for InputNode
export const INPUT_TYPES = [
  'Structure.PDB',
  'Structure.mmCIF',
  'Sequence.FASTA',
  'Sequence.FASTQ',
  'Text.RawString',
  'Text.Integer',
  'Text.Float',
];
