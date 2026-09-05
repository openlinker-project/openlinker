/**
 * Any-Role Route Decorator
 *
 * Marks a route handler as **deliberately open to every authenticated user**.
 *
 * `RolesGuard` denies by default (#2079), so a route carrying neither `@Roles()`
 * nor this decorator is refused. That is the point: before #2079 an undecorated
 * route authorized any authenticated principal, so "nobody decided" and
 * "everybody may" shared one representation — the absence of a decorator. This
 * decorator is the affirmative form, and the guard reads it.
 *
 * **Method level only — never on a class.** A class-level `@AnyRole()` silently
 * covers every route added to that class *later*, which re-creates
 * "undecorated inherits open" at class granularity and destroys the property
 * deny-by-default exists to buy: that a NEW route fails closed. The obvious
 * victim is a new PII route on `CustomersController`.
 * `route-authorization-coverage.spec.ts` fails the build on a class-level use.
 *
 * Note the asymmetry with `@Roles()`, which IS legitimate at class level (see
 * the `sales-documents` controllers): a NARROWING default is safe to inherit, a
 * WIDENING one is not.
 *
 * **It means "every role that exists today, deliberately."** Adding a role to
 * `UserRoleValues` silently widens every site — `user-role-values.spec.ts`
 * turns that into a build failure at exactly the moment the review is wanted.
 *
 * @module apps/api/src/auth/decorators
 * @see {@link Roles} for role-restricted routes
 * @see {@link Public} for routes that bypass authentication entirely
 */
import type { CustomDecorator } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';

export const ANY_ROLE_KEY = 'anyRole';
export const AnyRole = (): CustomDecorator<string> => SetMetadata(ANY_ROLE_KEY, true);
