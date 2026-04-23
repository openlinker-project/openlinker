/**
 * Prompt Template Render Helper
 *
 * Pure `{{dotted.path}}` substitution for prompt templates. Declared
 * variables are authoritative: a declared-required variable missing from
 * `values` throws `PromptTemplateRenderException`; a declared-optional
 * variable missing is substituted as empty string; an undeclared
 * `{{foo}}` placeholder is left in the output verbatim (passthrough) so
 * typos surface in the preview pane rather than silently blanking.
 *
 * Kept framework-free so the frontend can re-use the same algorithm via a
 * hand-ported duplicate exercised against the shared fixtures module.
 *
 * @module libs/core/src/ai/application/internal
 */
import { PromptTemplateRenderException } from '../../domain/exceptions/prompt-template-render.exception';
import type { PromptTemplateVariable } from '../../domain/types/prompt-template.types';

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
      // Undeclared placeholder — passthrough verbatim so the author can spot
      // typos in the preview pane. The lint-like feedback happens in the UI.
      return match;
    }

    const resolved = resolvePath(args.values, path);

    if (resolved === undefined || resolved === null) {
      if (declared.required) {
        throw new PromptTemplateRenderException(path);
      }
      return '';
    }

    return stringify(resolved, declared.type);
  });
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
  // Fallback for unexpected shapes — stringify rather than leaking "[object Object]".
  return JSON.stringify(value);
}
