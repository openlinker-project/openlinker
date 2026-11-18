/**
 * Saved View Definition Policy
 *
 * The API's implementation of core's `SavedViewDefinitionPolicyPort`: makes a
 * definition's filter `query` safe to persist and later replay against the
 * page's own list endpoint.
 *
 * 1. Parse it as `URLSearchParams` and REMOVE `search` (free text - a shared
 *    view would leak a buyer's email to every role), `offset`, `cursor`,
 *    `limit` and `withTotal` (position, not filter). Removal is silent by
 *    design: the frontend strips them too, and a client that forgot should
 *    still never persist them.
 * 2. Validate what remains against the page's existing list DTO with
 *    `whitelist` + `forbidNonWhitelisted`, so an unknown filter key is a 400.
 *    `skipMissingProperties` because a saved filter is a subset of the DTO.
 *
 * `columns` and `parts` stay opaque (size-limited by core).
 *
 * @module apps/api/src/saved-views
 */
import { Injectable, type Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  InvalidSavedViewError,
  type SavedViewDefinition,
  type SavedViewDefinitionPolicyPort,
} from '@openlinker/core/saved-views';
import {
  SAVED_VIEW_PAGES,
  SAVED_VIEW_STRIPPED_QUERY_KEYS,
  type SavedViewPageKey,
} from './saved-view-page-keys';

@Injectable()
export class SavedViewDefinitionPolicy implements SavedViewDefinitionPolicyPort {
  async normalise(pageKey: string, definition: SavedViewDefinition): Promise<SavedViewDefinition> {
    const page = SAVED_VIEW_PAGES[pageKey as SavedViewPageKey];
    if (page === undefined) {
      throw new InvalidSavedViewError('pageKey', `Unknown list page: ${pageKey}`, 'malformed');
    }

    const params = new URLSearchParams(definition.query);
    for (const key of SAVED_VIEW_STRIPPED_QUERY_KEYS) params.delete(key);

    const plain: Record<string, string | string[]> = {};
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      plain[key] = values.length === 1 ? values[0] : values;
    }

    // Widened: the registry's per-page DTO classes share no common instance type.
    const queryDto: Type<object> = page.queryDto;
    const instance = plainToInstance(queryDto, plain);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      skipMissingProperties: true,
    });
    if (errors.length > 0) {
      const detail = errors
        .map((e) => Object.values(e.constraints ?? {}).join(', ') || e.property)
        .join('; ');
      throw new InvalidSavedViewError(
        'definition.query',
        `The filter query is not valid for ${pageKey}: ${detail}`,
        'malformed'
      );
    }

    return { ...definition, query: params.toString() };
  }
}
