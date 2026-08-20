/**
 * Fiscalization Types - unit tests
 *
 * Pins the closed unions that cross the API, the DB and the plugin contract. A
 * silent reorder or addition here is a wire-format change, so it should require
 * a deliberate test edit.
 *
 * @module libs/core/src/fiscalization/domain/types
 */
import {
  FiscalArtefactDispositionValues,
  FiscalArtefactMediumValues,
  FiscalReconcileOutcomeValues,
  FiscalRegistrationFailureModeValues,
  FiscalRegistrationStatusValues,
} from './fiscalization.types';

describe('fiscalization.types', () => {
  it('exposes the documented registration lifecycle', () => {
    expect([...FiscalRegistrationStatusValues]).toEqual([
      'pending',
      'registering',
      'registered',
      'failed',
    ]);
  });

  it("declares fiscalization's OWN failure taxonomy (ADR-042 decision 7)", () => {
    // Mirrored from invoicing by design, never imported: the two taxonomies must
    // be free to diverge as their regimes do, instead of one silently inheriting
    // the other's extensions.
    expect([...FiscalRegistrationFailureModeValues]).toEqual(['rejected', 'in-doubt']);
  });

  it('carries an adapter-declared artefact medium rather than assuming a printable payload', () => {
    expect([...FiscalArtefactMediumValues]).toEqual([
      'document',
      'markup',
      'code',
      'link',
      'text',
    ]);
  });

  it('carries a disposition HINT, not a delivery instruction', () => {
    expect([...FiscalArtefactDispositionValues]).toEqual([
      'print',
      'display',
      'send',
      'retain',
    ]);
  });

  it('distinguishes "the provider holds no match" from "the provider cannot be asked"', () => {
    // Both leave the record in doubt; conflating them would hide from the
    // operator which of the two happened.
    expect([...FiscalReconcileOutcomeValues]).toEqual([
      'resolved',
      'not-found',
      'unsupported',
    ]);
  });
});
