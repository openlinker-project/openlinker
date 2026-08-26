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
  FISCAL_LOCATE_DETAIL_UNREADABLE,
  FiscalLocateStatusValues,
  FiscalReconcileOutcomeValues,
  FiscalRegistrationFailureModeValues,
  FiscalRegistrationStatusValues,
  readFiscalLocateAnswer,
  summarizeFiscalArtefacts,
} from './fiscalization.types';
import type { FiscalArtefact } from './fiscalization.types';

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
      'still-unknown',
    ]);
  });

  it('lets a locator say the provider HOLDS the sale without having registered it', () => {
    // Two outcomes forced a provider mid-processing to be reported as an
    // absence, which the operator surface then stated as one.
    expect([...FiscalLocateStatusValues]).toEqual(['registered', 'held', 'not-found']);
  });

  describe('readFiscalLocateAnswer', () => {
    it('reads an absent answer as `not-found`', () => {
      expect(readFiscalLocateAnswer(null)).toEqual({ status: 'not-found' });
      expect(readFiscalLocateAnswer(undefined)).toEqual({ status: 'not-found' });
    });

    it('reads the pre-#2502 result shape as `registered`', () => {
      // An out-of-tree adapter compiled against an older `libs/core` still
      // answers this way, and its non-null answer always meant `registered`.
      const legacy = {
        providerReference: 'p-1',
        documentReference: 'd-1',
        signingIdentity: null,
        registeredAt: null,
      };

      expect(readFiscalLocateAnswer(legacy)).toEqual({
        status: 'registered',
        registration: legacy,
      });
    });

    it('passes a well-formed answer through unchanged', () => {
      const registration = {
        providerReference: 'p-1',
        documentReference: null,
        signingIdentity: null,
        registeredAt: null,
      };

      expect(readFiscalLocateAnswer({ status: 'registered', registration })).toEqual({
        status: 'registered',
        registration,
      });
      expect(readFiscalLocateAnswer({ status: 'held', detail: 'PENDING' })).toEqual({
        status: 'held',
        detail: 'PENDING',
      });
      expect(readFiscalLocateAnswer({ status: 'not-found' })).toEqual({ status: 'not-found' });
    });

    it('reads a status this build does not recognise as `held`, never as a registration', () => {
      // Fail-safe in the fiscal direction: core must not terminalise a record on
      // an answer it cannot interpret.
      expect(readFiscalLocateAnswer({ status: 'whatever-comes-next' })).toEqual({
        status: 'held',
        detail: FISCAL_LOCATE_DETAIL_UNREADABLE,
      });
      expect(readFiscalLocateAnswer('nonsense')).toEqual({
        status: 'held',
        detail: FISCAL_LOCATE_DETAIL_UNREADABLE,
      });
    });

    it('reads an untagged object that is not a locate result as `held`', () => {
      // `registered` is terminal, so an answer carrying none of the identity
      // keys the result declares must not be read as one - it would strand the
      // record on a registration nothing confirmed.
      const unreadable = { status: 'held', detail: FISCAL_LOCATE_DETAIL_UNREADABLE };

      expect(readFiscalLocateAnswer({})).toEqual(unreadable);
      expect(readFiscalLocateAnswer([])).toEqual(unreadable);
      expect(readFiscalLocateAnswer({ somethingElse: 1 })).toEqual(unreadable);
      expect(readFiscalLocateAnswer({ status: 'registered', registration: {} })).toEqual(
        unreadable,
      );
    });

    it('marks an unread answer so it is never mistaken for the provider holding the sale', () => {
      // Both land on `held`, which is the safe direction, but only one of them
      // is a statement about the provider. A surface rendering the adapter's
      // sentence for the other would assert something no adapter supplied.
      const reported = readFiscalLocateAnswer({ status: 'held', detail: 'PENDING' });
      const unread = readFiscalLocateAnswer({ status: 'a-status-from-the-future' });

      expect(reported).toEqual({ status: 'held', detail: 'PENDING' });
      expect(unread).toEqual({ status: 'held', detail: FISCAL_LOCATE_DETAIL_UNREADABLE });
      expect(unread).not.toEqual(reported);
    });

    it('passes an adapter`s silent `held` through as silence, not as unread', () => {
      // An adapter that asserts `held` and declines to say more is still
      // asserting it. Stamping the unread marker there would overwrite the
      // adapter's claim with a fact about this build.
      expect(readFiscalLocateAnswer({ status: 'held' })).toEqual({
        status: 'held',
        detail: null,
      });
    });

    it('accepts a locate result whose identity fields are all null', () => {
      // Presence is tested, never truthiness: a regime that assigns few
      // identifiers reports them as null, and that is a normal confirmation.
      const registration = {
        providerReference: null,
        documentReference: null,
        signingIdentity: null,
        registeredAt: null,
      };

      expect(readFiscalLocateAnswer(registration)).toEqual({
        status: 'registered',
        registration,
      });
    });

    it('refuses to read a `registered` answer that carries no identity set', () => {
      expect(readFiscalLocateAnswer({ status: 'registered' })).toEqual({
        status: 'held',
        detail: FISCAL_LOCATE_DETAIL_UNREADABLE,
      });
    });
  });

  describe('summarizeFiscalArtefacts (#2523)', () => {
    const artefact = (overrides: Partial<FiscalArtefact> = {}): FiscalArtefact => ({
      medium: 'document',
      disposition: 'print',
      content: 'JVBERi0xLjQK-base64-payload',
      contentType: 'application/pdf',
      label: 'Receipt',
      ...overrides,
    });

    it('projects medium, disposition, label and content type, and NEVER the payload', () => {
      const [summary] = summarizeFiscalArtefacts([artefact()]) ?? [];

      expect(summary).toEqual({
        medium: 'document',
        disposition: 'print',
        label: 'Receipt',
        contentType: 'application/pdf',
      });
      // The point of the projection: an added payload field would have to be
      // added here deliberately, never inherited by a spread.
      expect(Object.keys(summary ?? {})).not.toContain('content');
      expect(JSON.stringify(summary)).not.toContain('base64-payload');
    });

    it('summarises several artefacts in order, one per artefact', () => {
      const summaries = summarizeFiscalArtefacts([
        artefact({ medium: 'link', disposition: 'send', contentType: null, label: null }),
        artefact({ medium: 'code', disposition: 'display', contentType: 'image/png' }),
        artefact(),
      ]);

      expect(summaries).toHaveLength(3);
      expect(summaries?.map((s) => s.medium)).toEqual(['link', 'code', 'document']);
      expect(summaries?.[0]?.label).toBeNull();
      expect(JSON.stringify(summaries)).not.toContain('base64-payload');
    });

    it('treats an EMPTY list as a successful registration that produced nothing', () => {
      // ADR-042 decision 2: a pure reporting regime returns identifiers only.
      // An empty summary is a complete answer, not a missing one.
      expect(summarizeFiscalArtefacts([])).toEqual([]);
    });

    it('keeps `null` distinct from empty', () => {
      // `null` means the registration never got far enough to produce anything.
      // Collapsing it into `[]` would report an unfinished attempt as a
      // completed pure-reporting registration.
      expect(summarizeFiscalArtefacts(null)).toBeNull();
      expect(summarizeFiscalArtefacts(undefined)).toBeNull();
    });

    it('carries no field a delivery claim could be derived from', () => {
      // No shipped adapter reports whether a document reached a buyer, so the
      // type must not be able to express it - no timestamp, recipient, status or
      // attempt count.
      const [summary] = summarizeFiscalArtefacts([artefact({ disposition: 'send' })]) ?? [];

      expect(Object.keys(summary ?? {}).sort()).toEqual([
        'contentType',
        'disposition',
        'label',
        'medium',
      ]);
    });
  });
});
