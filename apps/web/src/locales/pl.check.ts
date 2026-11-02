/**
 * Polish shape check
 *
 * Compiled by `tsc -b`, never imported at runtime. Fails the type-check when
 * pl.json does not fit the shape en.json declares: a string where English has
 * a section, a plural missing its Polish forms, or a key English lacks.
 *
 * @module locales
 */
import type { PolishCopy } from '../shared/i18n/copy.types';
import type { Messages } from '../shared/i18n/messages';
import pl from './pl.json';

const polish: PolishCopy<Messages> = pl;
void polish;
