/**
 * Invoicing: Transfer payments + bank accounts (#1573, scenario 7)
 *
 * The "live account picker" (#1303 follow-up) lives on the inFakt connection's
 * setup/edit screen (`InfaktSetupForm` / `EditConnectionForm` — a
 * `<Select>` labeled "Bank account for Transfer invoices", gated on
 * `defaultPaymentMethod === 'transfer'`), not on a per-invoice issuance
 * dialog: the picked account is stamped once at the connection level and
 * every subsequent Transfer invoice on that connection uses it. This spec
 * exercises the underlying capability at the API boundary (`BankAccountsReader`
 * / `BankAccountDefaultSetter`, `invoicing.controller.ts`) — fully
 * deterministic and independent of the exact form markup — plus a light
 * existence check that the connection's config surface renders.
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { ApiError } from '../../src/api/api-error';

test.describe('invoicing: Transfer payments + bank accounts', () => {
  /**
   * The account that was the provider default BEFORE this run flipped it.
   *
   * Flipping is not a read: per `BankAccountDefaultSetter`, the default account
   * is what EVERY subsequent Transfer invoice on that connection gets stamped
   * with - so a run that flips and walks away silently re-banks the operator's
   * future invoices. Captured here and restored in `afterAll` (not at the end of
   * the test body: a mid-test failure has already flipped it).
   */
  let restore: { connectionId: string; accountId: string } | null = null;

  test.afterAll(async ({ api }) => {
    if (!restore) return;
    try {
      await api.bankAccounts.setDefault(restore.connectionId, restore.accountId);
    } catch (error) {
      // Never rethrow from teardown - a restore failure must not mask the run's
      // real result - but never stay silent either: the stack is left banking
      // Transfer invoices to an account the operator did not choose.
      console.warn(
        `[e2e] MANUAL FOLLOW-UP: could not restore the inFakt default bank account to ` +
          `${restore.accountId} on connection ${restore.connectionId} (${String(error)}). Every ` +
          'Transfer invoice on that connection will be stamped with the account this run picked ' +
          'until it is set back by hand.',
      );
    }
  });

  test('lists the connection\'s bank accounts and sets a default that persists', async ({
    api,
    world,
    pages,
    page,
  }, testInfo) => {
    const infakt = world.connectionFor(PlatformType.infakt);
    test.skip(!infakt, 'no inFakt connection on this stack');

    const accounts = await api.bankAccounts.list(infakt!.id);
    // TWO accounts, not one. With a single account `accounts.find(a => !a.isDefault)
    // ?? accounts[0]` picks the account that is ALREADY the default, so
    // `setDefault` is a no-op, the `isDefault === true` assertion below passes on
    // the pre-existing flag, and the "at most one default" loop has zero
    // iterations - an adapter whose `setDefault` does nothing at all passes the
    // whole test. Only a real FLIP (a non-default account becoming the default,
    // and the previous one losing the flag) is falsifiable.
    test.skip(
      accounts.length < 2,
      `inFakt reports ${accounts.length} bank account(s) on this sandbox; the flip assertion ` +
        'needs at least 2 (with one, setDefault is a no-op that passes vacuously)',
    );

    const previousDefault = accounts.find((a) => a.isDefault);
    const target = accounts.find((a) => !a.isDefault)!;
    // Record the restore target BEFORE mutating. When no account was flagged
    // default, re-flagging on the way out is impossible (the capability has no
    // "clear default"), so leave `restore` null and say so in the annotation.
    if (previousDefault) {
      restore = { connectionId: infakt!.id, accountId: previousDefault.id };
    }
    await api.bankAccounts.setDefault(infakt!.id, target.id);

    const refreshed = await api.bankAccounts.list(infakt!.id);
    const flipped = refreshed.find((a) => a.id === target.id);
    expect(flipped, `account ${target.id} still present after setDefault`).toBeTruthy();
    expect(flipped!.isDefault, 'the picked account is now the provider default').toBe(true);
    // Every OTHER account must no longer be flagged default (at most one
    // default at a time).
    for (const other of refreshed) {
      if (other.id === target.id) continue;
      expect(other.isDefault, `account ${other.id} is no longer the default`).toBe(false);
    }

    testInfo.annotations.push({
      type: 'invoicing',
      description:
        `set ${target.bankName} - ${target.accountNumber} as the inFakt default bank account` +
        (restore
          ? ' (restored to the previous default on teardown)'
          : ' - NO previous default existed, so this flip is NOT reverted: every Transfer invoice ' +
            'on this connection is now stamped with it'),
    });

    // Light existence check: the connection's config surface (where the
    // Transfer-gated bank-account picker lives) renders without erroring.
    await pages.connectionDetail.goto(infakt!.id, 'config');
    await expect(page).toHaveURL(new RegExp(`/connections/${infakt!.id}\\?tab=config`));
  });

  test('a connection with no BankAccountDefaultSetter returns 501', async ({ api, world }) => {
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack (KSeF has no live bank-accounts API by design)');

    const error = await api.bankAccounts
      .setDefault(ksef!.id, 'irrelevant')
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(501);
  });
});
