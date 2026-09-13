import { loadEnv } from 'vite';

const HF_REPO_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateProductionModelSource(mode: string) {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const repoId = env.VITE_HF_MODEL_REPO?.trim();
  if (!repoId) {
    console.warn(
      'warning: VITE_HF_MODEL_REPO is not set; the production bundle falls back to the local /models/ static host. ' +
        'Set it to a public Hugging Face repository (for example, organization/instrumented-qwen3) for deployments.',
    );
    return;
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
