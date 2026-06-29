/**
 * KSeF NIP normalization
 *
 * Single source of truth for stripping the dashes/spaces an operator may paste
 * into a Polish NIP field. Both the create-path (`ksef-setup.schema.ts`) and the
 * edit-path (`edit-connection.schema.ts` zod transform + `mergeStructuredIntoConfig`)
 * call this so the persisted `config.sellerNip` shape (digits only) can't drift
 * between the two flows.
 *
 * @module features/connections/components
 */
export function normalizeNip(value: string): string {
  return value.replace(/[\s-]/g, '');
}
