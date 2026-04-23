/**
 * Render Template Unit Tests
 *
 * Exercises the pure `renderTemplate` helper against the shared fixtures.
 * The same fixtures are asserted by the frontend render helper test so
 * drift between runtimes fails CI.
 *
 * @module libs/core/src/ai/application/internal
 */
import { PromptTemplateRenderException } from '../../domain/exceptions/prompt-template-render.exception';
import { renderTemplate } from './render-template';
import {
  RENDER_HAPPY_PATH_FIXTURES,
  RENDER_THROW_FIXTURES,
} from './render-template.fixtures';

describe('renderTemplate', () => {
  describe('happy path fixtures', () => {
    for (const fixture of RENDER_HAPPY_PATH_FIXTURES) {
      it(`should render ${fixture.name}`, () => {
        const result = renderTemplate({
          template: fixture.template,
          declared: fixture.declared,
          values: fixture.values,
        });
        expect(result).toBe(fixture.expected);
      });
    }
  });

  describe('throwing fixtures', () => {
    for (const fixture of RENDER_THROW_FIXTURES) {
      it(`should throw when ${fixture.name}`, () => {
        expect(() =>
          renderTemplate({
            template: fixture.template,
            declared: fixture.declared,
            values: fixture.values,
          }),
        ).toThrow(PromptTemplateRenderException);
        try {
          renderTemplate({
            template: fixture.template,
            declared: fixture.declared,
            values: fixture.values,
          });
        } catch (err) {
          expect(err).toBeInstanceOf(PromptTemplateRenderException);
          expect((err as PromptTemplateRenderException).missingVariableName).toBe(
            fixture.missingVariableName,
          );
        }
      });
    }
  });

  it('should substitute the same placeholder multiple times', () => {
    const result = renderTemplate({
      template: '{{name}} and {{name}} again',
      declared: [{ name: 'name', type: 'string', required: true }],
      values: { name: 'Ada' },
    });
    expect(result).toBe('Ada and Ada again');
  });

  it('should leave text without placeholders untouched', () => {
    const result = renderTemplate({
      template: 'No placeholders here.',
      declared: [],
      values: {},
    });
    expect(result).toBe('No placeholders here.');
  });

  it('should allow whitespace inside placeholder braces', () => {
    const result = renderTemplate({
      template: '{{  name  }}',
      declared: [{ name: 'name', type: 'string', required: true }],
      values: { name: 'spaced' },
    });
    expect(result).toBe('spaced');
  });
});
