/**
 * Roles Guard
 *
 * Enforces role-based access control. **Denies by default** (#2079): a route
 * carrying neither `@Roles()` nor `@AnyRole()` is refused.
 *
 * Before #2079 the guard returned `true` when no `@Roles()` was present, so any
 * undecorated route authorized any authenticated principal — ~27% of the HTTP
 * surface, buyer PII among it. That was tolerable while every principal was an
 * OL user with one of three broadly-equivalent roles; ADR-071 arms it by adding
 * a narrower `packer` role, and a narrower role means nothing while an
 * undecorated route admits any authenticated principal.
 *
 * Resolution order, and why:
 *
 *  1. `@Public()` — allow. **Load-bearing, not defensive.** `JwtAuthGuard`
 *     bypasses authentication for public routes, so `req.user` is absent; this
 *     guard still runs (both are `APP_GUARD`s). Before #2079 a public route
 *     survived on the fail-open branch. Without this short-circuit,
 *     deny-by-default 403s `POST /auth/login`, `POST /auth/refresh`, every
 *     `POST /webhooks/:provider/:connectionId` delivery and the whole MCP
 *     transport. Pinned by `route-authorization-coverage.spec.ts` and by two
 *     no-`req.user` cases in this guard's own spec.
 *  2. `@AnyRole()` — allow, once a principal is present.
 *  3. `@Roles(...)` — the pre-#2079 membership check, unchanged.
 *  4. neither — deny.
 *
 * Precedence is resolved by SPECIFICITY, not by key. Two independent
 * `getAllAndOverride` calls can report a nonsensical pair — a class-level
 * `@Roles('admin')` with a method-level `@AnyRole()` returns both — so the
 * handler is resolved first as a unit and the class consulted only when the
 * handler carries neither decorator.
 *
 * Registered as the second APP_GUARD in AuthModule, after JwtAuthGuard.
 *
 * @module apps/api/src/auth/guards
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Logger } from '@openlinker/shared/logging';
import type { UserRole } from '@openlinker/core/users';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ANY_ROLE_KEY } from '../decorators/any-role.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../auth.types';

/**
 * What one decoration target (a handler, or a controller class) declares.
 *
 * `none` is the state #2079 exists to refuse; `contradiction` is a
 * configuration fault (both decorators on one target) that the coverage spec
 * also fails the build on.
 */
type RouteAuthorizationDeclaration =
  | { kind: 'none' }
  | { kind: 'any-role' }
  | { kind: 'roles'; roles: UserRole[] }
  | { kind: 'contradiction' };

/**
 * What `Reflector.get` accepts as a decoration target. Spelled via
 * `Parameters<>` because `ExecutionContext.getHandler()` returns `Function`
 * while `getClass()` returns `Type<any>`, and a plain `object` is assignable to
 * neither.
 */
type DecorationTarget = Parameters<Reflector['get']>[1];

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic =
      this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler()) === true ||
      this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getClass()) === true;
    if (isPublic) return true;

    const handlerDeclaration = this.readDeclaration(context.getHandler());
    const declaration =
      handlerDeclaration.kind === 'none'
        ? this.readDeclaration(context.getClass())
        : handlerDeclaration;

    if (declaration.kind === 'none') {
      this.logger.warn(
        `route_authorization_missing_decorator ${this.describeRoute(context)} carries neither ` +
          '@Roles() nor @AnyRole(); denying. Every route must declare its audience (#2079).'
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    if (declaration.kind === 'contradiction') {
      this.logger.warn(
        `route_authorization_missing_decorator ${this.describeRoute(context)} carries BOTH ` +
          '@Roles() and @AnyRole() on the same target; denying (#2079).'
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (declaration.kind === 'any-role') return true;

    if (!declaration.roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }

  /** Reads both keys off ONE target, so a handler cannot half-override a class. */
  private readDeclaration(target: DecorationTarget): RouteAuthorizationDeclaration {
    const anyRole = this.reflector.get<boolean>(ANY_ROLE_KEY, target) === true;
    const roles = this.reflector.get<UserRole[]>(ROLES_KEY, target);
    const hasRoles = Array.isArray(roles) && roles.length > 0;

    if (anyRole && hasRoles) return { kind: 'contradiction' };
    if (anyRole) return { kind: 'any-role' };
    if (hasRoles) return { kind: 'roles', roles };
    return { kind: 'none' };
  }

  private describeRoute(context: ExecutionContext): string {
    const controller = (context.getClass() as { name?: string } | undefined)?.name ?? 'unknown';
    const handler = (context.getHandler() as { name?: string } | undefined)?.name ?? 'unknown';
    return `${controller}.${handler}`;
  }
}
