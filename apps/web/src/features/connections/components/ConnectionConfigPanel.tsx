import type { ReactElement } from 'react';

interface ConnectionConfigPanelProps {
  config: Record<string, unknown>;
}

export function ConnectionConfigPanel({ config }: ConnectionConfigPanelProps): ReactElement {
  const keys = Object.keys(config);

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h3 className="section-title">Connection config</h3>
        </div>
        <span className="panel__meta">{keys.length} {keys.length === 1 ? 'key' : 'keys'}</span>
      </div>

      {keys.length === 0 ? (
        <p className="muted-text">No configuration values set.</p>
      ) : (
        <pre className="config-block mono-text">{JSON.stringify(config, null, 2)}</pre>
      )}
    </div>
  );
}
