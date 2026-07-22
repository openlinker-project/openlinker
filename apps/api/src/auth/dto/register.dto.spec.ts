/**
 * Register DTO — validation spec (#1728)
 *
 * Exercises the class-validator constraints on `RegisterDto`, in particular the
 * `@Matches(/^[^@]+$/)` rule on `username`. Forbidding '@' in usernames is the
 * precondition the login path relies on: `AuthService.validateUser` routes an
 * identifier containing '@' to the email lookup and one without to the username
 * lookup, so a username may never collide with someone else's email.
 *
 * @module apps/api/src/auth/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { RegisterDto } from './register.dto';

function buildDto(payload: Record<string, unknown>): RegisterDto {
  return plainToInstance(RegisterDto, payload);
}

const validPayload = {
  username: 'alice',
  email: 'alice@example.com',
  password: 'correct-horse-battery',
};

describe('RegisterDto', () => {
  it('should pass validation with a "@"-free username', async () => {
    const errors = await validate(buildDto(validPayload));

    expect(errors).toHaveLength(0);
  });

  it('should reject a username containing "@"', async () => {
    const errors = await validate(buildDto({ ...validPayload, username: 'victim@example.com' }));

    const usernameError = errors.find((e) => e.property === 'username');
    expect(usernameError?.constraints).toHaveProperty('matches');
  });
});
