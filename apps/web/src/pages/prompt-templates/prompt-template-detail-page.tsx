/**
 * Prompt Template Detail Page
 *
 * Admin editor for a single prompt template version. State-aware action
 * cluster: draft rows offer Save / Publish / Discard; published + archived
 * rows offer "New draft from this version". Below ≤ 1023 px the editor
 * collapses into a read-only view with a desktop-only affordance.
 *
 * @module apps/web/src/pages/prompt-templates
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { DesktopOnlyBanner } from '../../shared/ui/desktop-only-banner';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { KeyValueList } from '../../shared/ui/key-value-list';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Tabs, TabsList, TabsContent, TabsTrigger } from '../../shared/ui/tabs';
import { Textarea } from '../../shared/ui/textarea';
import { useToast } from '../../shared/ui/toast-provider';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { formatDateTime } from '../../shared/format/format-date';
import { formatRelativeTime } from '../../shared/format/format-relative-time';
import { usePromptTemplateQuery } from '../../features/prompt-templates/hooks/use-prompt-template-query';
import { usePromptTemplateVersionsQuery } from '../../features/prompt-templates/hooks/use-prompt-template-versions-query';
import {
  useCreatePromptTemplateMutation,
  useDeletePromptTemplateMutation,
  usePublishPromptTemplateMutation,
  useRevertPromptTemplateMutation,
  useUpdatePromptTemplateDraftMutation,
} from '../../features/prompt-templates/hooks/use-prompt-template-mutations';
import {
  extractPlaceholders,
  PromptTemplateRenderError,
  renderTemplate,
} from '../../features/prompt-templates/lib/render-template';
import type {
  PromptTemplate,
  PromptTemplateState,
  PromptTemplateVariable,
} from '../../features/prompt-templates/api/prompt-templates.types';

const STATE_TONE: Record<PromptTemplateState, StatusBadgeTone> = {
  draft: 'review',
  published: 'success',
  archived: 'neutral',
};

function channelLabel(channel: string | null): string {
  return channel === null ? 'master' : channel;
}

export function PromptTemplateDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isMobile = useMediaQuery('(max-width: 1023.98px)');

  const detailQuery = usePromptTemplateQuery(id);
  const template = detailQuery.data;
  const versionsQuery = usePromptTemplateVersionsQuery(template?.key, template?.channel ?? null);

  const updateMutation = useUpdatePromptTemplateDraftMutation();
  const publishMutation = usePublishPromptTemplateMutation();
  const createMutation = useCreatePromptTemplateMutation();
  const revertMutation = useRevertPromptTemplateMutation();
  const deleteMutation = useDeletePromptTemplateMutation();

  // #478: depend on the destructured stable `mutateAsync` methods, not
  // the wrapping mutation objects — `useMutation` returns a fresh wrapper
  // each render, which churns these callback identities.
  const { mutateAsync: updateDraft } = updateMutation;
  const { mutateAsync: publishTemplate } = publishMutation;
  const { mutateAsync: createTemplate } = createMutation;
  const { mutateAsync: revertTemplate } = revertMutation;
  const { mutateAsync: deleteTemplate } = deleteMutation;

  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPromptTemplate, setUserPromptTemplate] = useState('');
  const [variables, setVariables] = useState<PromptTemplateVariable[]>([]);
  const [sampleValuesJson, setSampleValuesJson] = useState('{}');
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    if (!template) return;
    setSystemPrompt(template.systemPrompt);
    setUserPromptTemplate(template.userPromptTemplate);
    setVariables(template.variables);
  }, [template]);

  const canEdit = template?.state === 'draft' && !isMobile;
  const isDirty = useMemo(() => {
    if (!template) return false;
    return (
      systemPrompt !== template.systemPrompt ||
      userPromptTemplate !== template.userPromptTemplate ||
      JSON.stringify(variables) !== JSON.stringify(template.variables)
    );
  }, [template, systemPrompt, userPromptTemplate, variables]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (template === undefined || !isDirty) return;
    try {
      await updateDraft({
        id: template.id,
        input: { systemPrompt, userPromptTemplate, variables },
      });
      showToast({ tone: 'success', description: 'Draft saved' });
    } catch {
      /* surfaced via updateMutation.error */
    }
  }, [template, systemPrompt, userPromptTemplate, variables, isDirty, updateDraft, showToast]);

  const handlePublish = useCallback(async (): Promise<void> => {
    if (template === undefined) return;
    setShowPublishConfirm(false);
    try {
      const result = await publishTemplate(template.id);
      showToast({ tone: 'success', description: `Published v${result.version}` });
    } catch {
      /* surfaced via publishMutation.error */
    }
  }, [template, publishTemplate, showToast]);

  const handleDiscard = useCallback(async (): Promise<void> => {
    if (template === undefined) return;
    setShowDiscardConfirm(false);
    try {
      await deleteTemplate(template.id);
      showToast({ tone: 'success', description: 'Draft discarded' });
      void navigate('/ai/prompt-templates');
    } catch {
      /* surfaced via deleteMutation.error */
    }
  }, [template, deleteTemplate, showToast, navigate]);

  const handleCreateDraftFromHere = useCallback(async (): Promise<void> => {
    if (template === undefined) return;
    try {
      const draft = await createTemplate({
        key: template.key,
        channel: template.channel,
        systemPrompt: template.systemPrompt,
        userPromptTemplate: template.userPromptTemplate,
        variables: template.variables,
      });
      showToast({ tone: 'success', description: `Draft v${draft.version} created` });
      void navigate(`/ai/prompt-templates/${draft.id}`);
    } catch {
      /* surfaced via createMutation.error */
    }
  }, [template, createTemplate, showToast, navigate]);

  const handleRevertTo = useCallback(
    async (version: number): Promise<void> => {
      if (template === undefined) return;
      try {
        const draft = await revertTemplate({
          key: template.key,
          channel: template.channel,
          version,
        });
        showToast({
          tone: 'success',
          description: `Draft v${draft.version} created from v${version}`,
        });
        void navigate(`/ai/prompt-templates/${draft.id}`);
      } catch {
        /* surfaced via revertMutation.error */
      }
    },
    [template, revertTemplate, showToast, navigate],
  );

  // Hook-order-safe: all hooks must run on every render. Compute the
  // preview derivations before any early returns.
  const undeclaredPlaceholders = useMemo(
    () => collectUndeclared(systemPrompt, userPromptTemplate, variables),
    [systemPrompt, userPromptTemplate, variables],
  );

  if (detailQuery.isLoading) {
    return (
      <PageLayout eyebrow="Settings" title="Prompt template">
        <LoadingState title="Loading prompt template" message="Fetching template data…" />
      </PageLayout>
    );
  }

  if (detailQuery.error) {
    return (
      <PageLayout eyebrow="Settings" title="Prompt template">
        <ErrorState
          title="Unable to load prompt template"
          message={detailQuery.error instanceof Error ? detailQuery.error.message : 'Unknown error'}
          action={
            <Button tone="secondary" onClick={() => void detailQuery.refetch()}>
              Retry
            </Button>
          }
        />
      </PageLayout>
    );
  }

  if (!template) {
    return (
      <PageLayout eyebrow="Settings" title="Prompt template">
        <EmptyState title="Template not found" message="The template may have been deleted." />
      </PageLayout>
    );
  }

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow="Settings" title="Prompt template">
        <ErrorState
          title="Admin role required"
          message="This page manages prompts that ship to the model and requires an admin session."
        />
      </PageLayout>
    );
  }

  const stateTone = STATE_TONE[template.state];
  const actions = buildActions({
    state: template.state,
    version: template.version,
    isDirty,
    canEdit,
    onSave: () => void handleSave(),
    onPublish: () => setShowPublishConfirm(true),
    onDiscard: () => setShowDiscardConfirm(true),
    onCreateDraftFromHere: () => void handleCreateDraftFromHere(),
    savePending: updateMutation.isPending,
    createPending: createMutation.isPending,
  });

  const previewValues = parseSampleValues(sampleValuesJson);
  const previewError = previewValues.ok
    ? tryRender(template, systemPrompt, userPromptTemplate, variables, previewValues.value)
    : null;

  return (
    <PageLayout
      eyebrow="Settings"
      title={<span className="mono-text">{template.key}</span>}
      description={`${channelLabel(template.channel)} · v${template.version} · ${template.state}`}
      actions={<div className="prompt-detail-actions">{actions}</div>}
    >
      {isMobile ? <DesktopOnlyBanner /> : null}

      {updateMutation.error ? (
        <Alert tone="error">{(updateMutation.error as Error).message}</Alert>
      ) : null}
      {publishMutation.error ? (
        <Alert tone="error">{(publishMutation.error as Error).message}</Alert>
      ) : null}
      {createMutation.error ? (
        <Alert tone="error">{(createMutation.error as Error).message}</Alert>
      ) : null}
      {revertMutation.error ? (
        <Alert tone="error">{(revertMutation.error as Error).message}</Alert>
      ) : null}
      {deleteMutation.error ? (
        <Alert tone="error">{(deleteMutation.error as Error).message}</Alert>
      ) : null}

      <div className="prompt-detail-layout">
        <section className="prompt-detail-editor">
          <div className="prompt-detail-header-strip">
            <StatusBadge tone={stateTone} withDot>
              {template.state}
            </StatusBadge>
            <span className="mono-text">v{template.version}</span>
            <StatusBadge tone="neutral" compact>
              {channelLabel(template.channel)}
            </StatusBadge>
          </div>

          <KeyValueList
            items={[
              {
                id: 'key',
                label: 'Key',
                value: <span className="mono-text">{template.key}</span>,
              },
              {
                id: 'created',
                label: 'Created',
                value: (
                  <span title={formatDateTime(template.createdAt)}>
                    {formatRelativeTime(template.createdAt)}
                    {template.createdBy !== null ? ` · ${template.createdBy}` : ''}
                  </span>
                ),
              },
              {
                id: 'updated',
                label: 'Updated',
                value: (
                  <span title={formatDateTime(template.updatedAt)}>
                    {formatRelativeTime(template.updatedAt)}
                  </span>
                ),
              },
              template.publishedAt !== null
                ? {
                    id: 'published',
                    label: 'Published',
                    value: (
                      <span title={formatDateTime(template.publishedAt)}>
                        {formatRelativeTime(template.publishedAt)}
                      </span>
                    ),
                  }
                : undefined,
            ].filter((item): item is NonNullable<typeof item> => item !== undefined)}
          />

          <Tabs defaultValue="system">
            <TabsList>
              <TabsTrigger value="system">System prompt</TabsTrigger>
              <TabsTrigger value="user">User prompt</TabsTrigger>
              <TabsTrigger value="variables">
                Variables ({variables.length})
              </TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="system">
              <Textarea
                className="prompt-detail-textarea"
                value={systemPrompt}
                readOnly={!canEdit}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={12}
              />
            </TabsContent>

            <TabsContent value="user">
              <Textarea
                className="prompt-detail-textarea"
                value={userPromptTemplate}
                readOnly={!canEdit}
                onChange={(event) => setUserPromptTemplate(event.target.value)}
                rows={12}
              />
            </TabsContent>

            <TabsContent value="variables">
              <VariablesEditor
                variables={variables}
                canEdit={canEdit}
                onChange={setVariables}
              />
            </TabsContent>

            <TabsContent value="preview">
              <PreviewPane
                template={template}
                systemPrompt={systemPrompt}
                userPromptTemplate={userPromptTemplate}
                variables={variables}
                sampleValuesJson={sampleValuesJson}
                onSampleValuesChange={setSampleValuesJson}
                previewError={previewError}
                undeclaredPlaceholders={undeclaredPlaceholders}
              />
            </TabsContent>
          </Tabs>
        </section>

        <aside className="prompt-detail-sidebar">
          <div className="panel panel--dense">
            <div className="panel__header">
              <p className="eyebrow">History</p>
              <h3 className="section-title">Version history</h3>
            </div>
            <VersionHistory
              versions={versionsQuery.data ?? []}
              currentId={template.id}
              isLoading={versionsQuery.isLoading}
              onOpen={(version) => {
                void navigate(`/ai/prompt-templates/${version.id}`);
              }}
              onRevert={(version) => void handleRevertTo(version.version)}
              revertPending={revertMutation.isPending}
            />
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={showPublishConfirm}
        onOpenChange={setShowPublishConfirm}
        title={`Publish v${template.version}?`}
        description="Current published version will be archived. The new prompt takes effect on the next suggestion request."
        confirmLabel={publishMutation.isPending ? 'Publishing…' : `Publish v${template.version}`}
        isConfirming={publishMutation.isPending}
        onConfirm={() => void handlePublish()}
      />

      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title={`Discard draft v${template.version}?`}
        description="All changes in this draft will be lost. This cannot be undone."
        confirmLabel={deleteMutation.isPending ? 'Discarding…' : 'Discard'}
        isConfirming={deleteMutation.isPending}
        tone="danger"
        onConfirm={() => void handleDiscard()}
      />
    </PageLayout>
  );
}

interface BuildActionsArgs {
  state: PromptTemplateState;
  version: number;
  isDirty: boolean;
  canEdit: boolean;
  savePending: boolean;
  createPending: boolean;
  onSave: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  onCreateDraftFromHere: () => void;
}

function buildActions(args: BuildActionsArgs): ReactElement[] {
  const buttons: ReactElement[] = [];
  if (args.state === 'draft') {
    buttons.push(
      <Button
        key="save"
        tone="primary"
        disabled={!args.canEdit || !args.isDirty || args.savePending}
        onClick={args.onSave}
      >
        {args.savePending ? 'Saving…' : 'Save draft'}
      </Button>,
    );
    buttons.push(
      <Button
        key="publish"
        tone="secondary"
        disabled={!args.canEdit || args.isDirty}
        onClick={args.onPublish}
      >
        Publish v{args.version}
      </Button>,
    );
    buttons.push(
      <Button key="discard" tone="ghost" disabled={!args.canEdit} onClick={args.onDiscard}>
        Discard draft
      </Button>,
    );
  } else {
    buttons.push(
      <Button
        key="new-draft"
        tone="primary"
        disabled={!args.canEdit || args.createPending}
        onClick={args.onCreateDraftFromHere}
      >
        {args.createPending ? 'Creating…' : 'New draft from this version'}
      </Button>,
    );
  }
  return buttons;
}

interface VariablesEditorProps {
  variables: PromptTemplateVariable[];
  canEdit: boolean;
  onChange: (next: PromptTemplateVariable[]) => void;
}

function VariablesEditor({ variables, canEdit, onChange }: VariablesEditorProps): ReactElement {
  const updateVariable = (index: number, patch: Partial<PromptTemplateVariable>): void => {
    const next = variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable));
    onChange(next);
  };

  const removeVariable = (index: number): void => {
    onChange(variables.filter((_, i) => i !== index));
  };

  const addVariable = (): void => {
    onChange([
      ...variables,
      { name: '', type: 'string', required: false, description: '' },
    ]);
  };

  if (variables.length === 0 && !canEdit) {
    return <p className="muted-text">No declared variables.</p>;
  }

  return (
    <div className="prompt-variables-editor">
      {variables.map((variable, index) => (
        <div key={index} className="prompt-variables-editor__row">
          <input
            className="control mono-text"
            type="text"
            value={variable.name}
            readOnly={!canEdit}
            placeholder="product.name"
            onChange={(event) => updateVariable(index, { name: event.target.value })}
          />
          <select
            className="control"
            value={variable.type}
            disabled={!canEdit}
            onChange={(event) =>
              updateVariable(index, {
                type: event.target.value as PromptTemplateVariable['type'],
              })
            }
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="object">object</option>
            <option value="array">array</option>
          </select>
          <label className="prompt-variables-editor__required">
            <input
              type="checkbox"
              checked={variable.required}
              disabled={!canEdit}
              onChange={(event) => updateVariable(index, { required: event.target.checked })}
            />
            required
          </label>
          <input
            className="control"
            type="text"
            value={variable.description ?? ''}
            readOnly={!canEdit}
            placeholder="Optional description"
            onChange={(event) => updateVariable(index, { description: event.target.value })}
          />
          {canEdit ? (
            <Button tone="ghost" onClick={() => removeVariable(index)}>
              Remove
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <Button tone="secondary" onClick={addVariable}>
          + Add variable
        </Button>
      ) : null}
    </div>
  );
}

interface PreviewPaneProps {
  template: PromptTemplate;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: PromptTemplateVariable[];
  sampleValuesJson: string;
  onSampleValuesChange: (next: string) => void;
  previewError:
    | { systemPrompt: string; userPrompt: string }
    | { error: string }
    | null;
  undeclaredPlaceholders: readonly string[];
}

function PreviewPane({
  systemPrompt,
  userPromptTemplate,
  variables,
  sampleValuesJson,
  onSampleValuesChange,
  previewError,
  undeclaredPlaceholders,
}: PreviewPaneProps): ReactElement {
  const parseResult = parseSampleValues(sampleValuesJson);
  const samplesPresent = parseResult.ok;

  const fillDemo = (): void => {
    const demo: Record<string, unknown> = {};
    for (const variable of variables) {
      const path = variable.name.split('.');
      let cursor: Record<string, unknown> = demo;
      for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i];
        const existing = cursor[key];
        if (existing === undefined || typeof existing !== 'object' || existing === null) {
          cursor[key] = {};
        }
        cursor = cursor[key] as Record<string, unknown>;
      }
      const leaf = path[path.length - 1];
      cursor[leaf] = defaultForType(variable);
    }
    onSampleValuesChange(JSON.stringify(demo, null, 2));
  };

  return (
    <div className="prompt-preview">
      <div className="prompt-preview__values">
        <div className="prompt-preview__values-header">
          <p className="eyebrow">Sample values</p>
          <Button tone="ghost" onClick={fillDemo}>
            Fill with demo
          </Button>
        </div>
        <Textarea
          className="prompt-preview__values-input mono-text"
          value={sampleValuesJson}
          onChange={(event) => onSampleValuesChange(event.target.value)}
          rows={10}
          aria-invalid={!samplesPresent}
        />
        {!samplesPresent ? (
          <p className="field-error" role="alert">
            Invalid JSON: {parseResult.error}
          </p>
        ) : null}
        {undeclaredPlaceholders.length > 0 ? (
          <Alert tone="warning" className="prompt-preview__undeclared">
            Undeclared placeholders render verbatim:{' '}
            {undeclaredPlaceholders.map((path) => (
              <code key={path} className="mono-text">{`{{${path}}} `}</code>
            ))}
          </Alert>
        ) : null}
      </div>

      <div className="prompt-preview__output">
        <article className="panel panel--dense">
          <header className="panel__header">
            <p className="eyebrow">System prompt</p>
            <span className="panel__meta mono-text">
              {systemPrompt.length} chars · ≈{Math.ceil(systemPrompt.length / 4)} tok
            </span>
          </header>
          {previewError && 'error' in previewError ? (
            <Alert tone="error">{previewError.error}</Alert>
          ) : previewError && 'systemPrompt' in previewError ? (
            <pre className="prompt-preview__rendered mono-text">{previewError.systemPrompt}</pre>
          ) : (
            <p className="muted-text">Preview unavailable.</p>
          )}
        </article>

        <article className="panel panel--dense">
          <header className="panel__header">
            <p className="eyebrow">User prompt</p>
            <span className="panel__meta mono-text">
              {userPromptTemplate.length} chars · ≈{Math.ceil(userPromptTemplate.length / 4)} tok
            </span>
          </header>
          {previewError && 'error' in previewError ? (
            <Alert tone="error">{previewError.error}</Alert>
          ) : previewError && 'userPrompt' in previewError ? (
            <pre className="prompt-preview__rendered mono-text">{previewError.userPrompt}</pre>
          ) : (
            <p className="muted-text">Preview unavailable.</p>
          )}
        </article>
      </div>
    </div>
  );
}

interface VersionHistoryProps {
  versions: PromptTemplate[];
  currentId: string;
  isLoading: boolean;
  onOpen: (version: PromptTemplate) => void;
  onRevert: (version: PromptTemplate) => void;
  revertPending: boolean;
}

function VersionHistory({
  versions,
  currentId,
  isLoading,
  onOpen,
  onRevert,
  revertPending,
}: VersionHistoryProps): ReactElement {
  if (isLoading) return <p className="muted-text">Loading versions…</p>;
  if (versions.length === 0) return <p className="muted-text">No version history.</p>;

  return (
    <ul className="prompt-history-list">
      {versions.map((version) => {
        const isCurrent = version.id === currentId;
        return (
          <li
            key={version.id}
            className={`prompt-history-list__row${isCurrent ? ' prompt-history-list__row--current' : ''}`}
          >
            <div className="prompt-history-list__meta">
              <span className="mono-text">v{version.version}</span>
              <StatusBadge tone={STATE_TONE[version.state]} compact>
                {version.state}
              </StatusBadge>
              <span className="muted-text" title={formatDateTime(version.updatedAt)}>
                {formatRelativeTime(version.updatedAt)}
              </span>
            </div>
            <div className="prompt-history-list__actions">
              {!isCurrent ? (
                <Button tone="ghost" onClick={() => onOpen(version)}>
                  Open
                </Button>
              ) : null}
              <Button tone="ghost" disabled={revertPending} onClick={() => onRevert(version)}>
                Revert
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function parseSampleValues(
  json: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Sample values must be a JSON object.' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

type RenderOutcome =
  | { systemPrompt: string; userPrompt: string }
  | { error: string };

function tryRender(
  _template: PromptTemplate,
  systemPrompt: string,
  userPromptTemplate: string,
  variables: PromptTemplateVariable[],
  values: Record<string, unknown>,
): RenderOutcome {
  try {
    return {
      systemPrompt: renderTemplate({
        template: systemPrompt,
        declared: variables,
        values,
      }),
      userPrompt: renderTemplate({
        template: userPromptTemplate,
        declared: variables,
        values,
      }),
    };
  } catch (err) {
    if (err instanceof PromptTemplateRenderError) {
      return { error: `Missing required value for \`${err.missingVariableName}\`.` };
    }
    return { error: err instanceof Error ? err.message : 'Render failed' };
  }
}

function collectUndeclared(
  systemPrompt: string,
  userPromptTemplate: string,
  variables: PromptTemplateVariable[],
): readonly string[] {
  const declared = new Set(variables.map((v) => v.name));
  const combined = [
    ...extractPlaceholders(systemPrompt),
    ...extractPlaceholders(userPromptTemplate),
  ];
  const result: string[] = [];
  for (const path of combined) {
    if (!declared.has(path) && !result.includes(path)) {
      result.push(path);
    }
  }
  return result;
}

function defaultForType(variable: PromptTemplateVariable): unknown {
  switch (variable.type) {
    case 'number':
      return 0;
    case 'object':
      return {};
    case 'array':
      return [];
    case 'string':
    default:
      return `sample-${variable.name}`;
  }
}
