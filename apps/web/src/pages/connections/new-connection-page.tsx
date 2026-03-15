import { CreateConnectionForm } from '../../features/connections/components/create-connection-form';

export function NewConnectionPage() {
  return (
    <section className="page-section">
      <div className="page-header">
        <p className="eyebrow">Integrations</p>
        <h2>New integration setup</h2>
        <p>Setup flows should be structured, explicit, and ready to evolve into step-based onboarding.</p>
      </div>

      <div className="toolbar">
        <div className="toolbar__group">
          <span className="toolbar-chip">Setup pattern</span>
          <span className="toolbar-chip">Validated form</span>
        </div>
        <div className="toolbar__group">
          <span className="muted-text">Draft to validate to activate</span>
        </div>
      </div>

      <CreateConnectionForm />
    </section>
  );
}
