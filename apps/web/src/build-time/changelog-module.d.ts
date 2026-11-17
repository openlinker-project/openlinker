declare module 'virtual:openlinker-changelog' {
  // An import type, not an import declaration: ambient modules may not import
  // by relative path, and the failed import silently typed the module as `any`.
  const changelog: import('./changelog-parser').ChangelogData;
  export default changelog;
}
