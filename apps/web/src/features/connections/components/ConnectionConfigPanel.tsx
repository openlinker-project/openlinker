import type { ReactElement } from 'react';
import { RawPayloadPanel } from '../../../shared/ui/raw-payload-panel';

interface ConnectionConfigPanelProps {
  config: Record<string, unknown>;
}

export function ConnectionConfigPanel({ config }: ConnectionConfigPanelProps): ReactElement {
  const keys = Object.keys(config);
  const description = `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`;

  if (keys.length === 0) {
    return (
      <div className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Configuration</p>
            <h3 className="section-title">Connection config</h3>
          </div>
          <span className="panel__meta">{description}</span>
        </div>
        <p className="muted-text">No configuration values set.</p>
      </div>
    );
  }

  return (
    <RawPayloadPanel
      title="Connection config"
      description={description}
      payload={config}
      defaultOpen
    />
  );
}
