import type { ReactElement } from 'react';
import { RawPayloadPanel } from '../../../shared/ui/raw-payload-panel';

interface ConnectionConfigPanelProps {
  config: Record<string, unknown>;
}

const AUTO_OPEN_KEY_THRESHOLD = 6;

export function ConnectionConfigPanel({ config }: ConnectionConfigPanelProps): ReactElement {
  const keys = Object.keys(config);
  const description = `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`;

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h3 className="section-title">Connection config</h3>
        </div>
        <span className="panel__meta">{description}</span>
      </div>

      {keys.length === 0 ? (
        <p className="muted-text">No configuration values set.</p>
      ) : (
        <RawPayloadPanel
          title="Raw config"
          payload={config}
          defaultOpen={keys.length <= AUTO_OPEN_KEY_THRESHOLD}
        />
      )}
    </div>
  );
}
