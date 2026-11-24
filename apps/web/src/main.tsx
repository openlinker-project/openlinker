import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { appRouter } from './app/router';
import { installStaleBuildReload } from './app/reload-on-stale-build';
import { AppProviders } from './app/providers/app-providers';
import { env } from './shared/config/env';
import { loadMessages } from './shared/i18n';
import { resolveInitialLocale } from './shared/i18n/resolve-locale';
import './index.css';

// A tab opened before a deploy asks for chunks the new build no longer has.
installStaleBuildReload(() => {
  const next = appRouter.state.navigation.location;
  return next ? `${next.pathname}${next.search}${next.hash}` : null;
});

function render(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}

// Load the opening language before the first paint, so a Polish session never
// flashes English while its files are on their way. The provider resolves the
// same language: a `?lang=` override is saved here and read back from storage.
// Plugin namespaces are registered by the imports above, before this runs.
void loadMessages(resolveInitialLocale(env.VITE_DEFAULT_UI_LOCALE)).then(render, render);
