import { FormField, Input, Select, Textarea, Combobox } from '@openlinker/web';

/**
 * Ported from the "Form controls" group at /dev/ui
 * (apps/web/src/pages/dev-ui/sections/primitives-section.tsx) plus the canonical
 * form pattern in .claude/rules/fe-pages.md. FormField owns label + description +
 * error placement and clones id / aria-describedby / aria-invalid onto its single
 * control child, so it only renders meaningfully around a real control.
 */

const stack = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  maxWidth: 460,
};

const noop = () => {};

export const WithDescription = () => (
  <div style={stack}>
    <FormField
      label="Connection name"
      name="ds-connection-name"
      description="Operator-facing label."
    >
      <Input defaultValue="Main Allegro store" />
    </FormField>
  </div>
);

export const WithError = () => (
  <div style={stack}>
    <FormField label="Buyer email" name="ds-buyer-email" error="Enter a valid email address.">
      <Input defaultValue="not-an-email" invalid />
    </FormField>
    <FormField
      label="Webhook endpoint"
      name="ds-webhook"
      description="Must be reachable over https."
      error="Must be an https:// URL."
    >
      <Input defaultValue="http://shop.example.com/hooks/openlinker" invalid />
    </FormField>
  </div>
);

export const AroundSelect = () => (
  <div style={stack}>
    <FormField
      label="Adapter"
      name="ds-adapter"
      description="Resolved per connection at runtime."
    >
      <Select defaultValue="allegro.publicapi.v1">
        <option value="allegro.publicapi.v1">allegro.publicapi.v1</option>
        <option value="prestashop.webservice.v1">prestashop.webservice.v1</option>
        <option value="shopify.admin.v2">shopify.admin.v2</option>
      </Select>
    </FormField>
  </div>
);

export const AroundTextarea = () => (
  <div style={stack}>
    <FormField
      label="Notes"
      name="ds-notes"
      description="Visible to every operator on this workspace."
    >
      <Textarea rows={3} placeholder="Operational notes for the team…" />
    </FormField>
  </div>
);

export const AroundCombobox = () => (
  <div style={stack}>
    <FormField
      label="Marka"
      name="ds-brand"
      description="Required by Allegro category 257."
      error="Select a brand from the Allegro dictionary."
    >
      <Combobox
        options={[
          { id: '11323_1', label: 'Reserved', hint: '11323_1' },
          { id: '11323_2', label: 'Zara', hint: '11323_2' },
        ]}
        value={null}
        onChange={noop}
        placeholder="Search 5,214 brands…"
      />
    </FormField>
  </div>
);

export const SettingsForm = () => (
  <div style={stack}>
    <FormField
      label="Stock safety buffer"
      name="ds-stock-buffer"
      description="Held back from every published quantity on this connection."
    >
      <Input type="number" defaultValue={3} />
    </FormField>
    <FormField
      label="Poll schedule"
      name="ds-cron"
      description="Cron expression, UTC."
      error="Unparseable cron expression — expected 5 fields, got 6."
    >
      <Input defaultValue="*/5 * * * * *" invalid />
    </FormField>
  </div>
);
