import type { ReactElement } from 'react';
import { useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { RawPayloadPanel } from '../../../shared/ui/raw-payload-panel';

interface ConnectionConfigPanelProps {
  config: Record<string, unknown>;
}

const AUTO_OPEN_KEY_THRESHOLD = 6;

export function ConnectionConfigPanel({ config }: ConnectionConfigPanelProps): ReactElement {
  const copy = useMessages('connections').connectionConfigPanel;
  const plural = usePlural();
  const format = useFormat();
  const keys = Object.keys(config);
  const description = plural(keys.length, copy.keyCount, { n: format.number(keys.length) });

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{description}</span>
      </div>

      {keys.length === 0 ? (
        <p className="muted-text">{copy.empty}</p>
      ) : (
        <RawPayloadPanel
          title={copy.rawConfig}
          payload={config}
          defaultOpen={keys.length <= AUTO_OPEN_KEY_THRESHOLD}
        />
      )}
    </div>
  );
}
