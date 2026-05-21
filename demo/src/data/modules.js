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
};

// Returns true if outputType can feed inputType
export function isCompatible(outputType, inputType) {
  if (!outputType || !inputType) return false;
  if (outputType === inputType) return true;
  // Parent accepts child: Input[Structure] accepts Structure.PDB
  if (outputType.startsWith(inputType + '.')) return true;
  // Union types: "Structure.PDB | Sequence.FASTA"
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
    description: 'Backbone design via diffusion',
    resources: { gpu: 1, memory_gb: 24 },
    retention: 'permanent',
    inputs: [
      { id: 'pdb_file', type: 'Structure.PDB' },
      { id: 'hotspot',  type: 'Text.RawString' },
    ],
    params: [
      { id: 'length', type: 'Text.Integer', default: 100 },
      { id: 'cycle',  type: 'Text.Integer', default: 50  },
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
    description: 'Structure prediction from sequence',
    resources: { gpu: 1, memory_gb: 40 },
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
      { id: 'scene',    type: 'Visual.Web3D' },
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
