export type VisualizationDefinition = {
  id: string;
  label: string;
  description: string;
};

export const VISUALIZATIONS: readonly VisualizationDefinition[] = [
  {
    id: 'attention-contributions',
    label: 'Attention contributions',
    description:
      'Explore which earlier token value vectors contribute to each destination token across transformer layers.',
  },
];

export function getVisualization(id: string) {
  return VISUALIZATIONS.find((visualization) => visualization.id === id);
}
