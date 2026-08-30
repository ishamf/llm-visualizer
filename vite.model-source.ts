import { loadEnv } from 'vite';

const HF_REPO_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateProductionModelSource(mode: string) {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const repoId = env.VITE_HF_MODEL_REPO?.trim();
  if (!repoId) {
    throw new Error(
      'VITE_HF_MODEL_REPO is required for production builds (for example, organization/instrumented-qwen3).',
    );
  }
  if (!HF_REPO_PATTERN.test(repoId)) {
    throw new Error(
      `VITE_HF_MODEL_REPO must be a Hugging Face repository ID in owner/name form; received ${JSON.stringify(repoId)}.`,
    );
  }
  if (
    env.VITE_HF_MODEL_REVISION !== undefined &&
    !env.VITE_HF_MODEL_REVISION.trim()
  ) {
    throw new Error('VITE_HF_MODEL_REVISION cannot be blank when provided.');
  }
}
