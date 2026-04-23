/**
 * Prompt Template Render Helper (Frontend)
 *
 * Hand-ported duplicate of the core `renderTemplate` helper
 * (`libs/core/src/ai/application/internal/render-template.ts`). Kept in the
 * frontend bundle to avoid pulling NestJS transitive imports through
 * `@openlinker/core/ai`. The shared fixtures module at
 * `libs/core/src/ai/application/internal/render-template.fixtures.ts` is
 * imported by both the core spec and the FE test — drift between the two
 * implementations fails CI.
 *
 * @module apps/web/src/features/prompt-templates/lib
 */
import type { PromptTemplateVariable } from '../api/prompt-templates.types';

export class PromptTemplateRenderError extends Error {
  public readonly missingVariableName: string;
  constructor(missingVariableName: string) {
    super(`Missing required variable "${missingVariableName}" for prompt template render.`);
    this.name = 'PromptTemplateRenderError';
    this.missingVariableName = missingVariableName;
  }
}

export interface RenderTemplateArgs {
  template: string;
  declared: readonly PromptTemplateVariable[];
  values: Record<string, unknown>;
}

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;

export function renderTemplate(args: RenderTemplateArgs): string {
  const declaredByName = new Map<string, PromptTemplateVariable>();
  for (const variable of args.declared) {
    declaredByName.set(variable.name, variable);
  }

  return args.template.replace(PLACEHOLDER_REGEX, (match, path: string) => {
    const declared = declaredByName.get(path);
    if (declared === undefined) {
      return match;
    }

    const resolved = resolvePath(args.values, path);

    if (resolved === undefined || resolved === null) {
      if (declared.required) {
        throw new PromptTemplateRenderError(path);
      }
      return '';
    }

    return stringify(resolved, declared.type);
  });
}

/**
 * Extract every `{{dotted.path}}` placeholder in the given text. Used by the
 * preview pane to flag undeclared placeholders before the author publishes.
 */
export function extractPlaceholders(template: string): readonly string[] {
  const result: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_REGEX)) {
    const path = match[1];
    if (path !== undefined && !result.includes(path)) {
      result.push(path);
    }
  }
  return result;
}

function resolvePath(values: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = values;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringify(value: unknown, type: PromptTemplateVariable['type']): string {
  if (type === 'object' || type === 'array') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
