/**
 * Render Template Shared Fixtures
 *
 * Pure test vectors shared between the core `render-template.spec.ts` and
 * the frontend `render-template.test.ts`. Keeping one set of fixtures and
 * asserting them from both runtimes catches FE/BE algorithm drift in CI.
 *
 * This file is deliberately import-free beyond the variable type from the
 * domain module — a CI grep asserts no `@nestjs/*` or `@openlinker/shared/*`
 * imports so the web bundle stays lean when the frontend consumes it.
 *
 * @module libs/core/src/ai/application/internal
 */
import type { PromptTemplateVariable } from '../../domain/types/prompt-template.types';

export interface RenderFixture {
  name: string;
  template: string;
  declared: readonly PromptTemplateVariable[];
  values: Record<string, unknown>;
  expected: string;
}

/**
 * Fixtures the renderer must satisfy. Keep the list small and load-bearing;
 * every entry documents a real behaviour the renderer ships with.
 */
export const RENDER_HAPPY_PATH_FIXTURES: readonly RenderFixture[] = [
  {
    name: 'simple single placeholder',
    template: 'Hello, {{name}}!',
    declared: [{ name: 'name', type: 'string', required: true }],
    values: { name: 'world' },
    expected: 'Hello, world!',
  },
  {
    name: 'dotted path resolution',
    template: 'Describe {{product.name}} in the {{product.category}} category.',
    declared: [
      { name: 'product.name', type: 'string', required: true },
      { name: 'product.category', type: 'string', required: false },
    ],
    values: { product: { name: 'Eco Wool Cap', category: 'Accessories' } },
    expected: 'Describe Eco Wool Cap in the Accessories category.',
  },
  {
    name: 'missing declared optional substitutes empty',
    template: 'Tone: {{tone}}. Write copy.',
    declared: [{ name: 'tone', type: 'string', required: false }],
    values: {},
    expected: 'Tone: . Write copy.',
  },
  {
    name: 'undeclared placeholder passthrough',
    template: 'Known: {{name}}. Unknown: {{foo}}.',
    declared: [{ name: 'name', type: 'string', required: true }],
    values: { name: 'Ada' },
    expected: 'Known: Ada. Unknown: {{foo}}.',
  },
  {
    name: 'object value is JSON-stringified',
    template: 'Attributes: {{product.attributes}}',
    declared: [{ name: 'product.attributes', type: 'object', required: false }],
    values: { product: { attributes: { color: 'red', size: 'M' } } },
    expected: 'Attributes: {"color":"red","size":"M"}',
  },
  {
    name: 'array value is JSON-stringified',
    template: 'Tags: {{tags}}',
    declared: [{ name: 'tags', type: 'array', required: false }],
    values: { tags: ['eco', 'wool'] },
    expected: 'Tags: ["eco","wool"]',
  },
  {
    name: 'number value coerces to string',
    template: 'Weight: {{weightGrams}}g',
    declared: [{ name: 'weightGrams', type: 'number', required: true }],
    values: { weightGrams: 250 },
    expected: 'Weight: 250g',
  },
];

/**
 * Fixtures where the renderer must throw `PromptTemplateRenderException`.
 * Asserted by both runtimes.
 */
export interface RenderThrowFixture {
  name: string;
  template: string;
  declared: readonly PromptTemplateVariable[];
  values: Record<string, unknown>;
  missingVariableName: string;
}

export const RENDER_THROW_FIXTURES: readonly RenderThrowFixture[] = [
  {
    name: 'required variable missing from values',
    template: 'Hello, {{name}}!',
    declared: [{ name: 'name', type: 'string', required: true }],
    values: {},
    missingVariableName: 'name',
  },
  {
    name: 'required dotted path missing mid-way',
    template: '{{product.name}}',
    declared: [{ name: 'product.name', type: 'string', required: true }],
    values: { product: {} },
    missingVariableName: 'product.name',
  },
  {
    name: 'required value is null',
    template: '{{name}}',
    declared: [{ name: 'name', type: 'string', required: true }],
    values: { name: null },
    missingVariableName: 'name',
  },
];
