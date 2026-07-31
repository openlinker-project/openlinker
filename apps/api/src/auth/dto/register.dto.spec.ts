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
  // Optional at the DTO layer (#1938 / #1945 review) — the demo requirement is
  // enforced by RegistrationService, so a self-hosted client may omit it.
  analyticsConsent: true,
};

describe('RegisterDto', () => {
  it('should pass validation with a "@"-free username', async () => {
    const errors = await validate(buildDto(validPayload));

    expect(errors).toHaveLength(0);
  });

  it('should accept a payload that omits analyticsConsent (#1938)', async () => {
    // The demo-only rule lives in RegistrationService: a required DTO field
    // would 400 every non-demo client for a flag that does nothing there.
    const withoutConsent = { ...validPayload };
    delete (withoutConsent as Partial<typeof validPayload>).analyticsConsent;
    const errors = await validate(buildDto(withoutConsent));

    expect(errors).toHaveLength(0);
  });

  it('should still reject a non-boolean analyticsConsent (#1938)', async () => {
    const errors = await validate(buildDto({ ...validPayload, analyticsConsent: 'yes' }));

    expect(errors.find((e) => e.property === 'analyticsConsent')?.constraints).toHaveProperty(
      'isBoolean',
    );
  });

  it('should reject a username containing "@"', async () => {
    const errors = await validate(buildDto({ ...validPayload, username: 'victim@example.com' }));

    const usernameError = errors.find((e) => e.property === 'username');
    expect(usernameError?.constraints).toHaveProperty('matches');
  });
});
