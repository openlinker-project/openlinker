/**
 * Role-Set Tripwire (#2079)
 *
 * `@AnyRole()` means **"every role that exists today, deliberately"**. It is
 * applied at 76 call sites, each one reviewed against the three roles that
 * exist now. Adding a role to `UserRoleValues` widens all 76 silently — and
 * the next role to be added is `packer` (#2413, ADR-071), whose entire purpose
 * is to be NARROWER than `operator`. Widening it onto buyer PII by omission is
 * exactly the outcome #2079 exists to prevent.
 *
 * This assertion turns that latent widening into a build failure at the moment
 * the review is wanted: the commit that adds the role.
 *
 * **It lives in `apps/api`, not beside the constant in `libs/core`.** The
 * message is about `@AnyRole()` call sites and every one of them is here; a
 * core-side assertion could not name them. Do not "tidy" it into
 * `libs/core/src/users/domain/types/`.
 *
 * @module apps/api/src/auth
 */
import { UserRoleValues } from '@openlinker/core/users';

describe('Role-set tripwire (#2079 / #2413)', () => {
  it('holds exactly the three roles every @AnyRole() site was reviewed against', () => {
    expect([...UserRoleValues]).toEqual(['admin', 'operator', 'viewer']);

    // If this failed for you: a role was added to UserRoleValues. Before
    // updating this list, review EVERY `@AnyRole()` route in apps/api and
    // decide whether the new role may call it. Routes reaching buyer PII
    // (CustomersController), fiscal documents (InvoicingController,
    // NumberingSeriesController) and connection configuration
    // (ConnectionController, CursorsController, SyncController,
    // WebhookDeliveryController, AdapterController, AllegroController) are the
    // ones a narrow role such as `packer` should almost certainly NOT reach —
    // see the audit in
    // docs/plans/implementation-plan-route-authorization-deny-by-default.md
    // § 2.3. Narrow them with @Roles(...) in the SAME commit that adds the
    // role; do not update this list first.
  });
});
