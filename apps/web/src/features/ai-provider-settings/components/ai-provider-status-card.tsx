/**
 * AI Provider Status Card
 *
 * Stateless presentation of `AiProviderSettingsView`. Renders provider name
 * (monospace), configured indicator, and a `StatusBadge` for the current
 * resolution source (`db` / `env` / `none`). Color is paired with text so
 * the source is never communicated by hue alone.
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import type { ReactElement } from 'react';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type {
  AiProviderKeySource,
  AiProviderSettingsView,
} from '../api/ai-provider-settings.types';

interface AiProviderStatusCardProps {
  view: AiProviderSettingsView;
}

const SOURCE_TONE: Record<AiProviderKeySource, StatusBadgeTone> = {
  db: 'success',
  env: 'warning',
  none: 'neutral',
};

const SOURCE_LABEL: Record<AiProviderKeySource, string> = {
  db: 'Stored encrypted',
  env: 'Env fallback (deprecated)',
  none: 'Not configured',
};

export function AiProviderStatusCard({ view }: AiProviderStatusCardProps): ReactElement {
  const items: KeyValueItem[] = [
    { id: 'provider', label: 'Active provider', mono: true, value: view.provider },
    {
      id: 'configured',
      label: 'Key configured',
      value: view.configured ? 'Yes' : 'No',
    },
    {
      id: 'source',
      label: 'Source',
      value: (
        <StatusBadge tone={SOURCE_TONE[view.source]} withDot>
          {SOURCE_LABEL[view.source]}
        </StatusBadge>
      ),
    },
  ];

  return (
    <section aria-labelledby="ai-provider-status-heading">
      <h2 id="ai-provider-status-heading" className="section-title">
        Status
      </h2>
      <KeyValueList items={items} />
    </section>
  );
}
