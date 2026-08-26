export type VisualizationDefinition = {
  id: string;
  kind: 'contribution-grid' | 'contribution-text';
  preferredFormat: 'layered' | 'summed';
  label: string;
  description: string;
};

export const VISUALIZATIONS: readonly VisualizationDefinition[] = [
  {
    id: 'attention-contributions',
    kind: 'contribution-grid',
    preferredFormat: 'layered',
    label: 'Attention contributions',
    description:
      'Explore which earlier token value vectors contribute to each destination token across transformer layers.',
  },
  {
    id: 'contribution-text',
    kind: 'contribution-text',
    preferredFormat: 'summed',
    label: 'Contribution text',
    description:
      'Read the prompt and generated response while token opacity reveals the strongest sources, summed across every transformer layer.',
  },
];

export function getVisualization(id: string) {
  return VISUALIZATIONS.find((visualization) => visualization.id === id);
}
