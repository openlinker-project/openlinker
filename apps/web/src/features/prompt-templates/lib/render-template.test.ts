/**
 * Prompt Template Render Helper — Frontend Tests
 *
 * Mirrors the core `render-template.spec.ts`. The fixtures below are a
 * hand-synced duplicate of
 * `libs/core/src/ai/application/internal/render-template.fixtures.ts` —
 * drift between the two implementations fails CI. See the plan at
 * `docs/plans/implementation-plan-341-editable-prompt-templates.md` §6.8.
 *
 * @module apps/web/src/features/prompt-templates/lib
 */
import { describe, expect, it } from 'vitest';
import type { PromptTemplateVariable } from '../api/prompt-templates.types';
import { PromptTemplateRenderError, renderTemplate, extractPlaceholders } from './render-template';

interface HappyFixture {
  name: string;
  template: string;
  declared: readonly PromptTemplateVariable[];
  values: Record<string, unknown>;
  expected: string;
}

interface ThrowFixture {
  name: string;
  template: string;
  declared: readonly PromptTemplateVariable[];
  values: Record<string, unknown>;
  missingVariableName: string;
}

// Keep this list in sync with RENDER_HAPPY_PATH_FIXTURES in
// libs/core/src/ai/application/internal/render-template.fixtures.ts
const HAPPY_FIXTURES: readonly HappyFixture[] = [
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

// Keep this list in sync with RENDER_THROW_FIXTURES in
// libs/core/src/ai/application/internal/render-template.fixtures.ts
const THROW_FIXTURES: readonly ThrowFixture[] = [
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

describe('renderTemplate (frontend)', () => {
  describe('happy path fixtures', () => {
    for (const fixture of HAPPY_FIXTURES) {
      it(`renders ${fixture.name}`, () => {
        expect(
          renderTemplate({
            template: fixture.template,
            declared: fixture.declared,
            values: fixture.values,
          }),
        ).toBe(fixture.expected);
      });
    }
  });

  describe('throwing fixtures', () => {
    for (const fixture of THROW_FIXTURES) {
      it(`throws when ${fixture.name}`, () => {
        expect(() =>
          renderTemplate({
            template: fixture.template,
            declared: fixture.declared,
            values: fixture.values,
          }),
        ).toThrow(PromptTemplateRenderError);
        try {
          renderTemplate({
            template: fixture.template,
            declared: fixture.declared,
            values: fixture.values,
          });
        } catch (err) {
          expect(err).toBeInstanceOf(PromptTemplateRenderError);
          expect((err as PromptTemplateRenderError).missingVariableName).toBe(
            fixture.missingVariableName,
          );
        }
      });
    }
  });

  it('substitutes the same placeholder multiple times', () => {
    expect(
      renderTemplate({
        template: '{{name}} and {{name}} again',
        declared: [{ name: 'name', type: 'string', required: true }],
        values: { name: 'Ada' },
      }),
    ).toBe('Ada and Ada again');
  });

  it('leaves text without placeholders untouched', () => {
    expect(
      renderTemplate({
        template: 'No placeholders here.',
        declared: [],
        values: {},
      }),
    ).toBe('No placeholders here.');
  });
});

describe('extractPlaceholders', () => {
  it('returns unique placeholder paths in order of first occurrence', () => {
    const result = extractPlaceholders('{{a}} {{b.c}} {{a}} {{d}}');
    expect(result).toEqual(['a', 'b.c', 'd']);
  });

  it('returns an empty list for plain text', () => {
    expect(extractPlaceholders('no vars here')).toEqual([]);
  });
});
