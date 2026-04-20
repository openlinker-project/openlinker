import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted IBM Plex (FE-002). Bundled by Vite — no external font CDN.
// Weights match `--font-sans` / `--font-mono` usage in `index.css`.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';

import { App } from './app/app';
import { AppProviders } from './app/providers/app-providers';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
