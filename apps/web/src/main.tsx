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
const openingLocale = resolveInitialLocale(env.VITE_DEFAULT_UI_LOCALE);
function start(): void {
  void loadMessages(openingLocale).then(render, render);
}

// Development-only missing-translation inspector (#4017). `import.meta.env.DEV`
// is a literal `false` in a production build, so the branch and its chunk are
// dropped there even with the variable set. It must install before the first
// load so every merge is tagged; a failed import just starts the app plainly.
if (import.meta.env.DEV && env.VITE_I18N_HIGHLIGHT_MISSING) {
  void import('./shared/i18n/missing-inspector')
    .then((inspector) => inspector.installMissingInspector())
    .catch(() => undefined)
    .then(start);
} else {
  start();
}
