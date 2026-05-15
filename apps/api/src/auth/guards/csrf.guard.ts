/**
 * CSRF Guard
 *
 * Double-submit-cookie CSRF protection for cookie-authenticated
 * state-mutating routes (#710 — `/auth/refresh`, `/auth/logout`).
 * Server sets `ol_csrf` (non-HttpOnly) at login; client mirrors the
 * value into `X-CSRF-Token` on every state-mutating request; this
 * guard rejects when the two disagree.
 *
 * Stateless: the cookie/header pair is the proof. No server-side
 * session is consulted.
 *
 * @module apps/api/src/auth/guards
 */
import type {
  CanActivate,
  ExecutionContext} from '@nestjs/common';
import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../auth.cookies';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const cookieValue: unknown = req.cookies?.[CSRF_COOKIE_NAME];
    const headerRaw = req.headers[CSRF_HEADER_NAME];
    const headerValue = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

    if (typeof cookieValue !== 'string' || !cookieValue || !headerValue) {
      throw new ForbiddenException('Missing CSRF token');
    }
    if (cookieValue !== headerValue) {
      throw new ForbiddenException('CSRF token mismatch');
    }
    return true;
  }
}
