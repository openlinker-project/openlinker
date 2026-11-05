/**
 * Prompt template errors (#3865)
 *
 * The coded HTTP errors for the prompt-template domain exceptions. Shared by
 * the prompt-templates controller and the content controller, which surfaces
 * the same exceptions from the description suggestion flow, so one situation
 * always answers with one code (ADR-081). `message` stays the domain
 * exception's English sentence.
 *
 * @module apps/api/src/ai/http
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import type {
  CannotArchivePublishedTemplateException,
  PromptTemplateNotFoundException,
  PromptTemplateRenderException,
  PromptTemplateStateException,
} from '@openlinker/core/ai';
import type { ApiErrorParams } from '@openlinker/shared/errors';
import { codedHttpError } from '../../common/errors/coded-http.exception';

function compactParams(
  values: Readonly<Record<string, string | number | null>>
): ApiErrorParams {
  const params: ApiErrorParams = {};
  for (const [name, value] of Object.entries(values)) {
    if (value !== null) params[name] = value;
  }
  return params;
}

export function promptTemplateNotFound(error: PromptTemplateNotFoundException): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'PROMPT_TEMPLATE_NOT_FOUND',
    error.message,
    compactParams({
      templateId: error.templateId,
      key: error.key,
      channel: error.channel,
      version: error.version,
    })
  );
}

export function promptTemplatePublishedNotArchivable(
  error: CannotArchivePublishedTemplateException
): HttpException {
  return codedHttpError(
    HttpStatus.CONFLICT,
    'PROMPT_TEMPLATE_PUBLISHED_NOT_ARCHIVABLE',
    error.message,
    compactParams({ templateId: error.templateId, key: error.key, channel: error.channel })
  );
}

export function promptTemplateStateInvalid(error: PromptTemplateStateException): HttpException {
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'PROMPT_TEMPLATE_STATE_INVALID',
    error.message,
    compactParams({
      templateId: error.templateId,
      actualState: error.actualState,
      requiredState: error.requiredState,
    })
  );
}

export function promptTemplateVariableMissing(error: PromptTemplateRenderException): HttpException {
  return codedHttpError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PROMPT_TEMPLATE_VARIABLE_MISSING',
    error.message,
    { variable: error.missingVariableName }
  );
}
