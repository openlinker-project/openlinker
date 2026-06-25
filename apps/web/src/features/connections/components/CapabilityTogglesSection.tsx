/**
 * CapabilityTogglesSection (#759)
 *
 * Generic, adapter-driven capability-toggle pattern. Renders one on/off
 * switch per entry in the `descriptors` prop, reading every human-facing
 * label/help string FROM that prop (AC-8 international safety — there is NO
 * provider-specific capability-name literal anywhere in this file; a test
 * asserts the source carries no such token).
 *
 * State ownership (docs/frontend-architecture.md): the toggle values live on
 * the RHF form field `subiektCapabilities` (`Record<string, boolean>`). On
 * change the section (1) `setValue`s the form field FIRST, then (2) calls the
 * host's `syncObjectToJson()` so the raw `configText` re-serializes from the
 * just-written form state. Reversing that order would persist the PREVIOUS
 * toggle state (the off-by-one-write trap).
 *
 * Each toggle is `disabled` while the raw JSON is unparseable — the host
 * serializer early-returns in that state, so allowing a flip would diverge
 * the form field from `configText` until the JSON is fixed (the divergence
 * trap). Mirrors the existing structured-input lock.
 *
 * Styling reuses `.capability-list__*` from `ConnectionCapabilitiesPanel`.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { EditConnectionFormValues } from './edit-connection.schema';

export interface CapabilityTogglesSectionProps {
  /** Adapter-provided label/help per capability id. AC-8 source of truth. */
  descriptors: Record<string, { label: string; help?: string }>;
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable — toggles are disabled (divergence gate). */
  configIsParseable: boolean;
  /** Host whole-object serializer; called AFTER setValue (ordering trap). */
  syncObjectToJson?: () => void;
}

export function CapabilityTogglesSection({
  descriptors,
  form,
  configIsParseable,
  syncObjectToJson,
}: CapabilityTogglesSectionProps): ReactElement {
  const values = form.watch('subiektCapabilities') ?? {};
  const keys = Object.keys(descriptors);

  const handleToggle = (key: string, checked: boolean): void => {
    // ORDERING TRAP: write the form field FIRST, then re-serialize. The host
    // `syncObjectToJson` reads CURRENT form state via `getValues`, so calling
    // it before `setValue` would persist the PREVIOUS toggle state.
    const next: Record<string, boolean> = { ...values, [key]: checked };
    form.setValue('subiektCapabilities', next, { shouldDirty: true });
    syncObjectToJson?.();
  };

  return (
    <ul className="capability-list">
      {keys.map((key) => {
        // AC-8: label/help are ADAPTER-PROVIDED — read strictly from the
        // `descriptors` prop, NEVER a literal in this shared component.
        const descriptor = descriptors[key];
        return (
          <li key={key} className="capability-list__item">
            <label className="capability-list__label">
              <input
                type="checkbox"
                checked={values[key] ?? false}
                disabled={!configIsParseable}
                onChange={(event) => handleToggle(key, event.target.checked)}
              />
              <span className="capability-list__name">{descriptor.label}</span>
            </label>
            {descriptor.help ? (
              <p className="capability-list__help">{descriptor.help}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
