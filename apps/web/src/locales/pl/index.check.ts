/**
 * Polish shape check
 *
 * Compiled by `tsc -b`, never imported at runtime (Polish files load lazily,
 * one per namespace, see `shared/i18n/messages.ts`). Fails the type-check when
 * a `pl/<namespace>.json` does not fit the shape its English file declares: a
 * string where English has a section, a plural missing its Polish forms, or a
 * key English lacks.
 *
 * Lists every `pl/*.json`; `scripts/check-locales.mjs` fails when a file is
 * missing here.
 *
 * @module locales
 */
import type { PolishCopy } from '../../shared/i18n/copy.types';
import type { Messages } from '../../shared/i18n/messages';
import format from './format.json';
import login from './login.json';
import loginPageSettings from './login-page-settings.json';
import ui from './ui.json';

const polish: PolishCopy<Messages> = {
  format,
  login,
  'login-page-settings': loginPageSettings,
  ui,
};
void polish;
