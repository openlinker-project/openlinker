/**
 * Automation errors (#3865)
 *
 * The coded HTTP errors the automation endpoints and services send. Each
 * carries a stable code and the values the frontend's copy needs (ADR-081);
 * `message` stays the English sentence the endpoint always sent.
 *
 * @module apps/api/src/automation
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import { codedHttpError } from '../common/errors/coded-http.exception';

export function automationRunNotFound(runId: string): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'AUTOMATION_RUN_NOT_FOUND',
    `Automation run "${runId}" not found.`,
    { runId }
  );
}

export function automationRuleNotFound(ruleId: string): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'AUTOMATION_RULE_NOT_FOUND',
    `Automation rule "${ruleId}" not found.`,
    { ruleId }
  );
}

/** A query or body field holds a value outside its closed vocabulary. */
export function automationFieldNotAllowed(path: string, message: string): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message, undefined, {
    fields: [{ path, code: 'isIn' }],
  });
}
