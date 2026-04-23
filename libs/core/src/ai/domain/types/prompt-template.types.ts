/**
 * Prompt Template Types
 *
 * Domain types for editable prompt templates. Exposes the state / channel /
 * variable-type value sets as `as const` arrays so the backend DTOs, the
 * frontend, and runtime validators all share a single source of truth. No
 * framework imports.
 *
 * @module libs/core/src/ai/domain/types
 */

/**
 * State machine for a template row. `draft` is editable, `published` is the
 * row the model actually receives for a given (key, channel), `archived` is
 * a previously-published row demoted by a subsequent publish.
 */
export const PromptTemplateStateValues = ['draft', 'published', 'archived'] as const;
export type PromptTemplateState = (typeof PromptTemplateStateValues)[number];

/**
 * Channel scoping. `null` channel rows are "master" / generic templates that
 * apply when no channel-specific override is published. Values here match the
 * platform types used elsewhere in the system (`prestashop`, `allegro`).
 */
export const PromptTemplateChannelValues = ['prestashop', 'allegro'] as const;
export type PromptTemplateChannel = (typeof PromptTemplateChannelValues)[number];

/**
 * Declared-variable type hint. Drives both serialisation in the render
 * helper (objects / arrays are JSON-stringified) and the input control
 * chosen in the admin UI (number → number input, object → mono JSON
 * textarea, etc.).
 */
export const PromptTemplateVariableTypeValues = ['string', 'number', 'object', 'array'] as const;
export type PromptTemplateVariableType = (typeof PromptTemplateVariableTypeValues)[number];

/**
 * Declared variable on a template. `name` is a dotted path (e.g.
 * `product.name`); the render helper resolves values by walking the path
 * against the caller-supplied `values` object.
 */
export interface PromptTemplateVariable {
  name: string;
  type: PromptTemplateVariableType;
  required: boolean;
  description?: string;
}
