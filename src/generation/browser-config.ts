import { UI_MODEL_PROFILE, type ModelProfile } from './config.ts';

export const BROWSER_MODEL_PROFILE: ModelProfile = UI_MODEL_PROFILE;

/** The static model directory exposed by the Vite development server. */
export const BROWSER_MODEL_ROOT = '/models/';
export const BROWSER_MODEL_PATH = `${BROWSER_MODEL_ROOT}${BROWSER_MODEL_PROFILE.id}`;
export const BROWSER_MODEL_WEIGHTS_PATH = `${BROWSER_MODEL_PATH}/onnx/${BROWSER_MODEL_PROFILE.instrumentation}_${BROWSER_MODEL_PROFILE.dtype}.onnx`;
/** Approximate size of the selected instrumented ONNX weights. */
export const BROWSER_MODEL_SIZE_BYTES = BROWSER_MODEL_PROFILE.modelSizeBytes;

export type BrowserModelSource =
  | { type: 'local'; baseUrl: string }
  | { type: 'hugging-face'; repoId: string; revision: string };

const HF_MODEL_REPO = import.meta.env.VITE_HF_MODEL_REPO?.trim();
const HF_MODEL_REVISION =
  import.meta.env.VITE_HF_MODEL_REVISION?.trim() || 'main';

/** Keep development local; production receives a public repository at build time. */
export const BROWSER_MODEL_SOURCE: BrowserModelSource =
  import.meta.env.DEV || !HF_MODEL_REPO
    ? { type: 'local', baseUrl: BROWSER_MODEL_ROOT }
    : {
        type: 'hugging-face',
        repoId: HF_MODEL_REPO,
        revision: HF_MODEL_REVISION,
      };

export type BrowserModelUrls = {
  root: string;
  weights: string;
};

export function getBrowserModelUrls(
  source: BrowserModelSource,
  documentBaseUrl: string,
): BrowserModelUrls {
  if (source.type === 'hugging-face') {
    const root = new URL(
      `${source.repoId}/resolve/${encodeURIComponent(source.revision)}/`,
      'https://huggingface.co/',
    );
    return {
      root: root.href,
      weights: new URL(
        `onnx/${BROWSER_MODEL_PROFILE.instrumentation}_${BROWSER_MODEL_PROFILE.dtype}.onnx`,
        root,
      ).href,
    };
  }

  const root = new URL(
    source.baseUrl.endsWith('/') ? source.baseUrl : `${source.baseUrl}/`,
    documentBaseUrl,
  ).href;
  const modelDirectory = new URL(`${BROWSER_MODEL_PROFILE.id}/`, root);
  return {
    root,
    weights: new URL(
      `onnx/${BROWSER_MODEL_PROFILE.instrumentation}_${BROWSER_MODEL_PROFILE.dtype}.onnx`,
      modelDirectory,
    ).href,
  };
}
