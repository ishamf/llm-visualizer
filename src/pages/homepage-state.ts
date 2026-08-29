export const DEFAULT_PROMPT_ID = 'summarize-office-move';

export function selectDefaultPromptId(availableIds: readonly string[]) {
  return availableIds.includes(DEFAULT_PROMPT_ID)
    ? DEFAULT_PROMPT_ID
    : (availableIds[0] ?? '');
}

export type HomepageGenerationState = {
  mode: 'pre-generated' | 'custom';
  session: number;
};

export type HomepageGenerationAction = { type: 'start' } | { type: 'clear' };

export const INITIAL_HOMEPAGE_GENERATION_STATE: HomepageGenerationState = {
  mode: 'pre-generated',
  session: 0,
};

export function homepageGenerationReducer(
  state: HomepageGenerationState,
  action: HomepageGenerationAction,
): HomepageGenerationState {
  if (action.type === 'start') return { ...state, mode: 'custom' };
  return { mode: 'pre-generated', session: state.session + 1 };
}
