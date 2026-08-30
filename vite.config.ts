import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

import { validateProductionModelSource } from './vite.model-source.ts';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') validateProductionModelSource(mode);

  return {
    plugins: [react()],
    server: {
      headers: crossOriginIsolationHeaders,
    },
    preview: {
      headers: crossOriginIsolationHeaders,
    },
    test: {
      clearMocks: true,
    },
  };
});
