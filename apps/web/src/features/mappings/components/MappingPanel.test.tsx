/**
 * MappingPanel Tests
 *
 * Locks in the rendering of the saved-mapping rows and the dropdown options,
 * including the new label + faded-id-hint treatment introduced for #474, plus
 * the existing loading / error / empty / dedup / save-flow paths that this
 * component has carried since #472. Plain `render` (no providers) — the
 * component is presentational and takes everything via props.
 *
 * @module apps/web/src/features/mappings/components
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MappingPanel, type MappingRow } from './MappingPanel';
import type { MappingOption } from '../api/mappings.types';

const baseProps = {
  title: 'Carrier Mappings',
  description: 'Map Allegro delivery methods to PrestaShop carriers.',
  sourceLabel: 'Allegro delivery method',
  targetLabel: 'PrestaShop carrier',
  isSaving: false,
  saveError: null,
  optionsLoading: false,
  optionsError: null,
};

const ALLEGRO_PACZKOMAT: MappingOption = {
  value: '1fa56f79-1234-5678-90ab-cdef12345678',
  label: 'Allegro Paczkomaty InPost',
};
const ALLEGRO_KURIER: MappingOption = {
  value: '7c2b3d4e-5678-90ab-cdef-1234567890ab',
  label: 'Allegro Kurier24 InPost',
};
const PS_INPOST: MappingOption = { value: '5', label: 'InPost Paczkomat' };
const PS_DPD: MappingOption = { value: '12', label: 'DPD courier' };

describe('MappingPanel', () => {
  afterEach(cleanup);

  describe('label + id-hint rendering (#474)', () => {
    it('renders the human label plus a truncated id-hint when value !== label', () => {
      const savedRows: MappingRow[] = [
        { sourceValue: ALLEGRO_PACZKOMAT.value, targetValue: PS_INPOST.value },
      ];
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_INPOST]}
          savedRows={savedRows}
          onSave={vi.fn()}
        />,
      );

      // Primary label visible.
      expect(screen.getByText('Allegro Paczkomaty InPost')).toBeInTheDocument();
      // Id-hint truncated to 8 chars + ellipsis (matches the issue example shape).
      expect(screen.getByText('1fa56f79…')).toBeInTheDocument();
      const hint = screen.getByText('1fa56f79…');
      expect(hint).toHaveClass('mapping-id-hint');
    });

    it('skips the id-hint when value === label (degraded data)', () => {
      // Adapter fallback path: when Allegro returns no `method.name`, the
      // adapter uses the id as the label. Verify we don't render the hint
      // twice in that case.
      const sameValueAsLabel: MappingOption = { value: 'PAYU_GATEWAY', label: 'PAYU_GATEWAY' };
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[sameValueAsLabel]}
          targetOptions={[]}
          savedRows={[{ sourceValue: 'PAYU_GATEWAY', targetValue: '' }]}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getAllByText('PAYU_GATEWAY')).toHaveLength(1);
      expect(screen.queryByText('PAYU_GATEWAY…')).toBeNull();
    });

    it('renders short values verbatim with no ellipsis', () => {
      // PrestaShop carrier ids are small ints — `5`, `12`. The truncation
      // helper must short-circuit on length ≤ 9.
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_INPOST]}
          savedRows={[{ sourceValue: ALLEGRO_PACZKOMAT.value, targetValue: PS_INPOST.value }]}
          onSave={vi.fn()}
        />,
      );

      // PS target carrier id is `5` — should render as `5`, not `5…`.
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.queryByText('5…')).toBeNull();
    });

    it('renders dropdown options as plain "Label (truncatedValue)" text', () => {
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT, ALLEGRO_KURIER]}
          targetOptions={[PS_INPOST]}
          savedRows={[]}
          onSave={vi.fn()}
        />,
      );

      const select = screen.getByRole('combobox', { name: /select allegro delivery method/i });
      const options = within(select).getAllByRole('option');
      // First option is the placeholder ("— Allegro delivery method —"), then the two methods.
      expect(options[1]).toHaveTextContent('Allegro Paczkomaty InPost (1fa56f79…)');
      expect(options[2]).toHaveTextContent('Allegro Kurier24 InPost (7c2b3d4e…)');
    });

    it("decorates dynamic-kind options with the runtime-behaviour suffix in the dropdown (#517)", () => {
      // The OL Dynamic carrier (kind: 'dynamic') means PS reads buyer-paid
      // shipping from the sidecar at order-total time (#516). Native
      // <option> is text-only, so the cue is encoded as a label suffix.
      const PS_OL_DYNAMIC: MappingOption = {
        value: '99',
        label: 'OpenLinker Dynamic',
        kind: 'dynamic',
      };
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_INPOST, PS_OL_DYNAMIC]}
          savedRows={[]}
          onSave={vi.fn()}
        />,
      );

      const targetSelect = screen.getByRole('combobox', { name: /select prestashop carrier/i });
      const options = within(targetSelect).getAllByRole('option');
      // Static option: bare label + (id) — no behaviour suffix.
      expect(options[1]).toHaveTextContent('InPost Paczkomat (5)');
      // Dynamic option: same shape + " — exact Allegro cost" suffix.
      expect(options[2]).toHaveTextContent('OpenLinker Dynamic (99) — exact Allegro cost');
    });

    it('decorates dynamic-kind options in the saved-row table cell (#517)', () => {
      const PS_OL_DYNAMIC: MappingOption = {
        value: '99',
        label: 'OpenLinker Dynamic',
        kind: 'dynamic',
      };
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_OL_DYNAMIC]}
          savedRows={[{ sourceValue: ALLEGRO_PACZKOMAT.value, targetValue: '99' }]}
          onSave={vi.fn()}
        />,
      );

      // Both the saved-row table cell and the (native) <option> in the
      // re-pick dropdown carry the suffix text. The styled cell wraps it
      // in a <span class="mapping-option__dynamic-suffix">; the native
      // <option> renders flat text. Scope the assertion to the styled
      // span by class so we only catch the cell instance.
      const styledSuffixes = screen
        .getAllByText(/— exact Allegro cost/)
        .filter((el) => el.classList.contains('mapping-option__dynamic-suffix'));
      expect(styledSuffixes).toHaveLength(1);
    });

    it('does NOT add the dynamic suffix to static options', () => {
      // Regression guard: only `kind === 'dynamic'` triggers the cue. A
      // static option with no `kind` field stays bare.
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_INPOST]}
          savedRows={[{ sourceValue: ALLEGRO_PACZKOMAT.value, targetValue: PS_INPOST.value }]}
          onSave={vi.fn()}
        />,
      );

      expect(screen.queryByText(/exact Allegro cost/)).toBeNull();
    });

    it('falls back to the raw value when a saved mapping references a value missing from the source options', () => {
      // Seller deleted the cennik on Allegro's side — saved row points at a
      // method id no longer in the live list. Render the raw value so the
      // operator can still see what's there.
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[]}
          targetOptions={[]}
          savedRows={[{ sourceValue: 'orphan-id-xyz', targetValue: 'orphan-target' }]}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getByText('orphan-id-xyz')).toBeInTheDocument();
      expect(screen.getByText('orphan-target')).toBeInTheDocument();
    });
  });

  describe('panel states', () => {
    it('renders LoadingState while options are loading', () => {
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[]}
          targetOptions={[]}
          savedRows={[]}
          onSave={vi.fn()}
          optionsLoading
        />,
      );
      expect(screen.getByText(/loading carrier mappings options/i)).toBeInTheDocument();
    });

    it('renders ErrorState when options fail to load', () => {
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[]}
          targetOptions={[]}
          savedRows={[]}
          onSave={vi.fn()}
          optionsError={new Error('Allegro 502')}
        />,
      );
      expect(screen.getByText(/unable to load options/i)).toBeInTheDocument();
      expect(screen.getByText('Allegro 502')).toBeInTheDocument();
    });

    it('shows the empty-state copy when no rows are configured', () => {
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_INPOST]}
          savedRows={[]}
          onSave={vi.fn()}
        />,
      );
      expect(screen.getByText(/no mappings configured yet/i)).toBeInTheDocument();
    });
  });

  describe('add-row flow', () => {
    it('filters already-mapped sources out of the add-row dropdown', () => {
      // Primary dedup affordance: an already-mapped source can't be re-picked
      // because it's removed from `availableSourceOptions`. Defensive
      // `setAddError` branch in `handleAddRow` only fires for programmatic
      // bypasses, which the UI can't trigger.
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT, ALLEGRO_KURIER]}
          targetOptions={[PS_INPOST, PS_DPD]}
          savedRows={[{ sourceValue: ALLEGRO_PACZKOMAT.value, targetValue: PS_INPOST.value }]}
          onSave={vi.fn()}
        />,
      );

      const select = screen.getByRole('combobox', { name: /select allegro delivery method/i });
      const optionTexts = within(select)
        .getAllByRole('option')
        .map((o) => o.textContent ?? '');
      // Mapped Paczkomat is gone from the add-row dropdown; only Kurier remains.
      expect(optionTexts.some((t) => t.includes('Paczkomaty'))).toBe(false);
      expect(optionTexts.some((t) => t.includes('Kurier24'))).toBe(true);
    });

    it('save flow calls onSave with the full row list', () => {
      const onSave = vi.fn();
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_INPOST]}
          savedRows={[{ sourceValue: ALLEGRO_PACZKOMAT.value, targetValue: PS_INPOST.value }]}
          onSave={onSave}
        />,
      );

      // Save button is disabled when not dirty — remove a row to dirty the
      // panel, then click Save.
      const removeButton = screen.getByRole('button', { name: /remove mapping/i });
      fireEvent.click(removeButton);

      const saveButton = screen.getByRole('button', { name: /save mappings/i });
      expect(saveButton).not.toBeDisabled();
      fireEvent.click(saveButton);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith([]);
    });
  });

  describe('deep-link pre-focus (#1794)', () => {
    it('pre-selects an unmapped, known focusSourceValue and shows the hint', () => {
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT, ALLEGRO_KURIER]}
          targetOptions={[PS_INPOST]}
          savedRows={[]}
          onSave={vi.fn()}
          focusSourceValue={ALLEGRO_PACZKOMAT.value}
          focusSourceName="Allegro Paczkomaty InPost"
        />,
      );

      expect(
        screen.getByText((_, element) => element?.textContent === 'Map Allegro Paczkomaty InPost to a prestashop carrier below.'),
      ).toBeInTheDocument();
      const select = screen.getByRole('combobox', { name: /select allegro delivery method/i });
      expect(select).toHaveValue(ALLEGRO_PACZKOMAT.value);

      // savedRows is empty here — the pre-existing "no mappings configured
      // yet" empty state and the deep-link focus hint are both role="status"
      // and would otherwise announce together. Only the focus hint may render.
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.queryByText(/No mappings configured yet/)).not.toBeInTheDocument();
    });

    it('does not pre-select or show the hint when focusSourceValue is already mapped', () => {
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_PACZKOMAT]}
          targetOptions={[PS_INPOST]}
          savedRows={[{ sourceValue: ALLEGRO_PACZKOMAT.value, targetValue: PS_INPOST.value }]}
          onSave={vi.fn()}
          focusSourceValue={ALLEGRO_PACZKOMAT.value}
          focusSourceName="Allegro Paczkomaty InPost"
        />,
      );

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      const select = screen.getByRole('combobox', { name: /select allegro delivery method/i });
      expect(select).toHaveValue('');
    });

    it('does not pre-select or show the hint when focusSourceValue is absent from sourceOptions', () => {
      render(
        <MappingPanel
          {...baseProps}
          sourceOptions={[ALLEGRO_KURIER]}
          targetOptions={[PS_INPOST]}
          savedRows={[]}
          onSave={vi.fn()}
          focusSourceValue="unknown-method-id"
          focusSourceName="Unknown method"
        />,
      );

      // Scoped to the deep-link hint specifically — the panel's pre-existing
      // "no mappings configured yet" empty state also renders role="status".
      expect(screen.queryByText(/Unknown method/)).not.toBeInTheDocument();
      const select = screen.getByRole('combobox', { name: /select allegro delivery method/i });
      expect(select).toHaveValue('');
    });
  });
});
