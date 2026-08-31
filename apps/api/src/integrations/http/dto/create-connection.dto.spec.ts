/**
 * `CreateConnectionDto` — credential-field validation (#2405)
 *
 * ## Why this file exists
 *
 * The credential-less OMS connection (ADR-055) depends on a factual claim
 * about *which layer* refuses a credential-less create. That claim is easy to
 * get wrong by reading decorators, because `@Validate(CredentialsXorConstraint)`
 * sits on the `credentials` property alongside `@IsOptional()` — and
 * class-validator skips **all** of a property's validators when its value is
 * `undefined`. So the XOR constraint does not run at all on a body that omits
 * `credentials`, and the DTO's live gate for the credential-less shape is
 * `@Matches(/^db:/)` on `credentialsRef`, which fires only when that field is
 * present.
 *
 * These cases pin that behaviour rather than assuming it: the relaxation in
 * `ConnectionService.create` is only sufficient if the DTO really does let an
 * omitted pair through, and the frontend really must omit the key rather than
 * send `''`.
 *
 * @module apps/api/src/integrations/http/dto
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateConnectionDto } from './create-connection.dto';

const base = {
  name: 'OpenLinker OMS',
  platformType: 'openlinker',
  config: { locationSetId: 'default' },
};

const errorsFor = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(CreateConnectionDto, payload), {
    whitelist: false,
    forbidNonWhitelisted: false,
  }).flatMap((e) => Object.values(e.constraints ?? {}));

describe('CreateConnectionDto — credential fields', () => {
  it('should accept a body that omits BOTH credential fields', () => {
    // The credential-less shape the OMS create form sends. If this ever starts
    // failing, the frontend cannot create an OMS connection at all and the
    // service-level relaxation is unreachable.
    expect(errorsFor({ ...base })).toEqual([]);
  });

  it('should REJECT an explicitly empty credentialsRef', () => {
    // `@IsOptional()` skips only `null`/`undefined`, so `''` is validated and
    // fails both `@IsNotEmpty()` and `@Matches(/^db:/)`. This is exactly the
    // trap the frontend mapper has to avoid: it must omit the key, not send an
    // empty string.
    expect(errorsFor({ ...base, credentialsRef: '' }).join(' ')).toMatch(/db:/);
  });

  it('should reject a raw (non-db:) credentialsRef', () => {
    expect(errorsFor({ ...base, credentialsRef: 'raw-key' }).join(' ')).toMatch(
      /must start with "db:"/
    );
  });

  it('should reject supplying BOTH credentials and credentialsRef', () => {
    // The one arm the XOR constraint still reaches: `credentials` is defined,
    // so `@IsOptional()` does not short-circuit and the constraint runs.
    expect(
      errorsFor({
        ...base,
        credentials: { apiKey: 'x' },
        credentialsRef: 'db:550e8400-e29b-41d4-a716-446655440000',
      }).join(' ')
    ).toMatch(/Exactly one of/);
  });

  it('should accept credentials alone', () => {
    expect(errorsFor({ ...base, credentials: { apiKey: 'x' } })).toEqual([]);
  });

  it('should accept a db: credentialsRef alone', () => {
    expect(
      errorsFor({ ...base, credentialsRef: 'db:550e8400-e29b-41d4-a716-446655440000' })
    ).toEqual([]);
  });
});
