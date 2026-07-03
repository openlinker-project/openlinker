/**
 * KSeF NIP normalization
 *
 * Single source of truth for stripping the dashes/spaces an operator may paste
 * into a Polish NIP field. Both the create-path (`ksef-setup.schema.ts`) and the
 * edit-path (`ksef-connection-config.ts` zod transform + assembly)
 * call this so the persisted `config.seller.nip` shape (digits only) can't drift
 * between the two flows.
 *
 * @module plugins/ksef/lib
 */
export function normalizeNip(value: string): string {
  return value.replace(/[\s-]/g, '');
}
