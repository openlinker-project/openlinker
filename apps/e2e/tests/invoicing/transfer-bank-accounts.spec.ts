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
  test('lists the connection\'s bank accounts and sets a default that persists', async ({
    api,
    world,
    pages,
    page,
  }, testInfo) => {
    const infakt = world.connectionFor(PlatformType.infakt);
    test.skip(!infakt, 'no inFakt connection on this stack');

    const accounts = await api.bankAccounts.list(infakt!.id);
    test.skip(accounts.length === 0, 'inFakt reports no bank accounts on this sandbox account');

    const target = accounts.find((a) => !a.isDefault) ?? accounts[0]!;
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
      description: `set ${target.bankName} — ${target.accountNumber} as the inFakt default bank account`,
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
