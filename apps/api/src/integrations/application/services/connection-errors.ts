/**
 * Connection errors (#3864)
 *
 * The coded HTTP errors `ConnectionService` sends. Each carries a stable code
 * and the values the frontend's copy needs (ADR-081); `message` stays the
 * English sentence the endpoint always sent, for developers and logs.
 *
 * @module apps/api/src/integrations/application/services
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import type { ApiErrorParams } from '@openlinker/shared/errors';
import { codedHttpError } from '../../../common/errors/coded-http.exception';
import type { ConnectionConfigRule } from './connection-errors.types';

/** A refused `config` value. `field` is the dotted path, e.g. `config.rateLimit.maxConcurrent`. */
export function connectionConfigInvalid(
  field: string,
  rule: ConnectionConfigRule,
  message: string,
  bounds: ApiErrorParams = {}
): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'CONNECTION_CONFIG_INVALID', message, {
    field,
    rule,
    ...bounds,
  });
}

/** `allowed` values travel as one comma-separated string: params are scalars. */
export function allowedValues(values: readonly string[]): string {
  return values.join(', ');
}

export function connectionNotFound(connectionId: string, message: string): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'CONNECTION_NOT_FOUND', message, {
    connectionId,
  });
}

export function capabilitiesUnsupported(
  adapterKey: string,
  capabilities: readonly string[]
): HttpException {
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'CONNECTION_CAPABILITIES_UNSUPPORTED',
    `Capabilities not supported by adapter ${adapterKey}: ${capabilities.join(', ')}`,
    { adapterKey, capabilities: capabilities.join(', ') }
  );
}

export function credentialsInputAmbiguous(): HttpException {
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'CREDENTIALS_INPUT_AMBIGUOUS',
    'Exactly one of `credentials` or `credentialsRef` must be provided'
  );
}

/**
 * A credentials rewriter refused the payload (e.g. Erli could not read the
 * reused Allegro connection). Its sentence is plugin-authored and carries no
 * buyer data, so it travels as `providerMessage` beside the code.
 */
export function providerRejected(provider: string, providerMessage: string): HttpException {
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'PROVIDER_REJECTED',
    providerMessage,
    { provider },
    { providerMessage }
  );
}

/**
 * `config.stockLocationOverride` is refused. The code also stays in `error`,
 * where the connection form has read it since #3207.
 */
export function stockLocationOverrideInvalid(
  message: string,
  params: ApiErrorParams
): HttpException {
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'STOCK_LOCATION_OVERRIDE_INVALID',
    message,
    { field: 'config.stockLocationOverride', ...params },
    { error: 'STOCK_LOCATION_OVERRIDE_INVALID' }
  );
}
