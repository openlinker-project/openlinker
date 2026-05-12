/**
 * Content — public surface
 *
 * Public barrel for the content feature (#609). Cross-feature consumers
 * (today: `features/listings` for the suggestion-dialog plumbing) import
 * from here; deep imports are banned by ESLint.
 */
export { SuggestionDialog } from './components/suggestion-dialog';
export { resolveSuggestChannel } from './api/content.utils';
