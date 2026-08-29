import { defineContributionTextElement } from './contribution-text-element.tsx';

const builtWorkerPath = './workers/browser-generation.js';
const developmentWorkerPath = '../generation/browser-generation.worker.ts';
const workerUrl = import.meta.env.DEV
  ? new URL(developmentWorkerPath, import.meta.url)
  : new URL(builtWorkerPath, import.meta.url);

defineContributionTextElement(workerUrl);
