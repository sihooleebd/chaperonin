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
  if (outputType.startsWith(inputType + '.')) return true;
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
