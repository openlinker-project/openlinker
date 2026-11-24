/**
 * User management errors (#3865)
 *
 * The coded HTTP errors the admin user-management endpoints send. Each
 * carries a stable code and the values the frontend's copy needs (ADR-081);
 * `message` stays the English sentence the endpoint always sent.
 *
 * @module apps/api/src/users/http
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import { CannotSelfModifyException } from '@openlinker/core/users';
import { codedHttpError } from '../../common/errors/coded-http.exception';

export function userNotFound(userId: string, message: string): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', message, { userId });
}

/** A self-modification or a change that would leave no admin. */
export function userChangeForbidden(error: Error): HttpException {
  return error instanceof CannotSelfModifyException
    ? codedHttpError(HttpStatus.FORBIDDEN, 'USER_CANNOT_MODIFY_SELF', error.message)
    : codedHttpError(HttpStatus.FORBIDDEN, 'USER_LAST_ADMIN', error.message);
}
