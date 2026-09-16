/**
 * Product release version (root `package.json`, bumped by release-please —
 * see release-please-config.json). Injected at build time via the
 * `__APP_VERSION__` global (`vite.config.ts` `define`), so it always reflects
 * the version the release line actually cut, with no manual sync step.
 *
 * Declared ambient and module-local (no global.d.ts) — `apps/**\/*.d.ts` is
 * gitignored as a build-artifact guard, and no other file needs to see this
 * constant. `typeof` guards a context where the define never ran (e.g. a
 * stray script import outside the Vite/Vitest build graph) rather than
 * throwing a ReferenceError.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
