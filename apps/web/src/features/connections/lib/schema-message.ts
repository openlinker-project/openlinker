/**
 * Schema message
 *
 * Zod validation messages for the connection setup schemas, read from the
 * `connections` namespace when a value is validated rather than when the
 * schema module loads - so a schema built once at module level still speaks
 * the operator's current language.
 *
 * @module features/connections/lib
 */
import { getMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';

type ConnectionsCopy = ResolvedCopy<Messages['connections']>;

/** Zod `{ error }` parameter whose text is looked up at validation time. */
export interface LazySchemaMessage {
  error: () => string;
}

/**
 * Returns a picker for one section of `connections`:
 * `const msg = schemaMessage('shoperSetupSchema'); z.string().min(1, msg('nameRequired'))`.
 */
export function schemaMessage<S extends keyof ConnectionsCopy>(
  section: S,
): (key: keyof ConnectionsCopy[S] & string) => LazySchemaMessage {
  return (key) => ({
    error: (): string =>
      String((getMessages('connections')[section] as Record<string, unknown>)[key]),
  });
}
