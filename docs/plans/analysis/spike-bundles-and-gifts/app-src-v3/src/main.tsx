import { createRoot } from 'react-dom/client';
import '@web/index.css';
import './spike.css';
import { LocaleProvider } from '@web/shared/i18n/locale-provider';
import { App } from './App';

// The app's dark theme keys on html[data-theme]; the viewer sets it only on an
// explicit choice, so follow the OS preference when it is absent.
function syncTheme(): void {
  const root = document.documentElement;
  if (root.dataset.themeExplicit === '1') return;
  const explicit = root.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') {
    root.dataset.themeExplicit = '1';
    return;
  }
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
}
syncTheme();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  delete document.documentElement.dataset.themeExplicit;
  syncTheme();
});

const el = document.getElementById('spike-root');
if (el) {
  createRoot(el).render(
    <LocaleProvider locale="en">
      <App />
    </LocaleProvider>,
  );
}
