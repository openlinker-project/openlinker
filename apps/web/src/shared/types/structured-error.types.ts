/**
 * Structured Error Types
 *
 * Cross-cutting data shape for structured `{ field?, code, message }` errors
 * emitted by platform adapters (content publish, offer creation, …) and
 * rendered by `StructuredErrorList` in `shared/ui/`.
 *
 * Hoisted from `shared/ui/structured-error-list.tsx` to `shared/types/`
 * (#613) so the platform-plugin slot in `shared/plugins/plugin.types.ts`
 * can reference the shape without cross-importing from a UI primitive.
 * `structured-error-list.tsx` re-exports both names for backwards
 * compatibility with existing consumers.
 *
 * @module shared/types
 */

export interface StructuredError {
  field?: string;
  code: string;
  message: string;
}

export interface StructuredErrorTranslation {
  message: string;
}
