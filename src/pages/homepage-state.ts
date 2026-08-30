export const DEFAULT_PROMPT_ID = 'summarize-office-move';

export function selectDefaultPromptId(availableIds: readonly string[]) {
  return availableIds.includes(DEFAULT_PROMPT_ID)
    ? DEFAULT_PROMPT_ID
    : (availableIds[0] ?? '');
}
