import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, type MantineColorSchemeManager } from '@mantine/core';
import { HashRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import './index.css';
import './App.css';
import App from './App.tsx';

const browserColorSchemeManager: MantineColorSchemeManager = {
  get: () => 'auto',
  set: () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  clear: () => undefined,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider
      colorSchemeManager={browserColorSchemeManager}
      defaultColorScheme="auto"
    >
      <HashRouter>
        <App />
      </HashRouter>
    </MantineProvider>
  </StrictMode>,
);
