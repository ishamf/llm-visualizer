import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

import { validateProductionModelSource } from './vite.model-source.ts';

export default defineConfig(({ command, mode }) => {
  if (command === 'build') validateProductionModelSource(mode);

  return {
    base: './',
    plugins: [react()],
    publicDir: false,
    build: {
      outDir: 'dist-web-component',
      sourcemap: true,
      rollupOptions: {
        input: {
          'contribution-text': resolve(
            import.meta.dirname,
            'src/web-component/entry.ts',
          ),
          'workers/browser-generation': resolve(
            import.meta.dirname,
            'src/generation/browser-generation.worker.ts',
          ),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'static/chunks/[name]-[hash].js',
          assetFileNames: 'static/assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
