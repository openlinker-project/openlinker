/**
 * User management error codes (#3865)
 *
 * @module apps/api/src/users/http
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CannotSelfModifyException, LastAdminException } from '@openlinker/core/users';
import { userChangeForbidden, userNotFound } from './users-errors';

describe('users errors (#3865)', () => {
  it('should send USER_NOT_FOUND with the user id', () => {
    const error = userNotFound('u1', 'User not found: u1');

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found: u1',
      params: { userId: 'u1' },
    });
  });

  it('should tell a self-modification apart from the last-admin rule', () => {
    const self = userChangeForbidden(new CannotSelfModifyException());
    const lastAdmin = userChangeForbidden(new LastAdminException());

    expect(self).toBeInstanceOf(ForbiddenException);
    expect(self.getResponse()).toEqual(expect.objectContaining({ code: 'USER_CANNOT_MODIFY_SELF' }));
    expect(lastAdmin.getResponse()).toEqual(expect.objectContaining({ code: 'USER_LAST_ADMIN' }));
  });
});
