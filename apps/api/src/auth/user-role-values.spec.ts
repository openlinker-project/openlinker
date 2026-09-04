/**
 * Role-Set Tripwire (#2079, discharged and re-armed by #2413)
 *
 * `@AnyRole()` means **"every role that exists today, deliberately"**. Adding a
 * role to `UserRoleValues` widens every `@AnyRole()` site silently, so this
 * assertion turns that latent widening into a build failure at the moment the
 * review is wanted: the commit that adds the role.
 *
 * ## The #2413 review is DISCHARGED, not waived
 *
 * `packer` (ADR-071) was the role #2079 armed this for. All 76 `@AnyRole()`
 * routes were reviewed against it and **45** were narrowed to
 * `@Roles('admin', 'operator', 'viewer')` — behaviourally identical for every
 * user who exists today, excluding `packer` by construction. The disposition,
 * the principle it applies and the two groups the review ADDED to the owner's
 * four are recorded in
 * `docs/plans/implementation-plan-bench-packer-role-idle-lock-handover.md` § 2.3.
 *
 * The list below was extended only after that. **Never extend it first.**
 *
 * ## This is the weaker of the two guards, and knows it
 *
 * A list somebody must remember to think about is discharged by anybody willing
 * to add a string. The load-bearing half is `packer-exclusion.spec.ts`, which
 * asserts over discovered route metadata that **every** `@AnyRole()` route in
 * `apps/api` appears on an explicit 31-entry allow-list — so a new open route
 * fails the build wherever it lands, including on a controller nobody has
 * written yet, whether or not anyone re-reads this file.
 *
 * (It is deliberately NOT a list of excluded controllers. That form guards only
 * the controllers somebody thought of, which is the hand-listed-array failure
 * #2079's coverage spec exists to remove.)
 *
 * **It lives in `apps/api`, not beside the constant in `libs/core`.** The
 * message is about `@AnyRole()` call sites and every one of them is here; a
 * core-side assertion could not name them. Do not "tidy" it into
 * `libs/core/src/users/domain/types/`.
 *
 * @module apps/api/src/auth
 */
import { ROLE_PERMISSIONS, UserRoleValues } from '@openlinker/core/users';

describe('Role-set tripwire (#2079 / #2413)', () => {
  it('holds exactly the four roles every @AnyRole() site was reviewed against', () => {
    expect([...UserRoleValues]).toEqual(['admin', 'operator', 'viewer', 'packer']);

    // If this failed for you: a role was added to UserRoleValues. Before
    // updating this list, review EVERY `@AnyRole()` route in apps/api and
    // decide whether the new role may call it — the current inventory is
    // reproducible from `route-authorization-coverage.spec.ts`'s own discovery
    // machinery, and grepping for the decorator is NOT equivalent (it
    // mis-reads multi-line decorators and cannot resolve class-vs-handler
    // precedence). Narrow with @Roles(...) in the SAME commit that adds the
    // role; do not update this list first.
  });

  it('gives `packer` no permissions, because none describes packing yet', () => {
    // Not a placeholder. `usePermission` drives FE navigation visibility, so
    // granting `orders:read` merely to populate the Record would light up the
    // orders surface for a packer — the opposite of a narrower role. Backend
    // authorization is @Roles, not this map. See role.types.ts.
    expect(ROLE_PERMISSIONS.packer).toEqual([]);
  });
});
