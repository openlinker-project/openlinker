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
import {
  getMessages,
  interpolate,
  useFormat,
  useMessages,
  usePlural,
} from '../../shared/i18n';
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
import { describeApiError } from '../../shared/api/describe-api-error';

const STATE_TONE: Record<PromptTemplateState, StatusBadgeTone> = {
  draft: 'review',
  published: 'success',
  archived: 'neutral',
};

function channelLabel(channel: string | null): string {
  return channel === null ? getMessages('prompt-templates').common.master : channel;
}

function stateLabel(state: PromptTemplateState): string {
  return getMessages('prompt-templates').common.states[state] ?? state;
}

export function PromptTemplateDetailPage(): ReactElement {
  const messages = useMessages('prompt-templates');
  const copy = messages.promptTemplateDetailPage;
  const format = useFormat();
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
      showToast({ tone: 'success', description: copy.toasts.saved });
    } catch {
      /* surfaced via updateMutation.error */
    }
  }, [template, systemPrompt, userPromptTemplate, variables, isDirty, updateDraft, showToast, copy]);

  const handlePublish = useCallback(async (): Promise<void> => {
    if (template === undefined) return;
    setShowPublishConfirm(false);
    try {
      const result = await publishTemplate(template.id);
      showToast({
        tone: 'success',
        description: interpolate(copy.toasts.published, { version: result.version }),
      });
    } catch {
      /* surfaced via publishMutation.error */
    }
  }, [template, publishTemplate, showToast, copy]);

  const handleDiscard = useCallback(async (): Promise<void> => {
    if (template === undefined) return;
    setShowDiscardConfirm(false);
    try {
      await deleteTemplate(template.id);
      showToast({ tone: 'success', description: copy.toasts.discarded });
      void navigate('/ai/prompt-templates');
    } catch {
      /* surfaced via deleteMutation.error */
    }
  }, [template, deleteTemplate, showToast, navigate, copy]);

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
      showToast({
        tone: 'success',
        description: interpolate(copy.toasts.created, { version: draft.version }),
      });
      void navigate(`/ai/prompt-templates/${draft.id}`);
    } catch {
      /* surfaced via createMutation.error */
    }
  }, [template, createTemplate, showToast, navigate, copy]);

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
          description: interpolate(copy.toasts.reverted, { draft: draft.version, version }),
        });
        void navigate(`/ai/prompt-templates/${draft.id}`);
      } catch {
        /* surfaced via revertMutation.error */
      }
    },
    [template, revertTemplate, showToast, navigate, copy],
  );

  // Hook-order-safe: all hooks must run on every render. Compute the
  // preview derivations before any early returns.
  const undeclaredPlaceholders = useMemo(
    () => collectUndeclared(systemPrompt, userPromptTemplate, variables),
    [systemPrompt, userPromptTemplate, variables],
  );

  if (detailQuery.isLoading) {
    return (
      <PageLayout eyebrow={messages.common.eyebrow} title={copy.title}>
        <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />
      </PageLayout>
    );
  }

  if (detailQuery.error) {
    return (
      <PageLayout eyebrow={messages.common.eyebrow} title={copy.title}>
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(detailQuery.error, 'prompt-templates')}
          action={
            <Button tone="secondary" onClick={() => void detailQuery.refetch()}>
              {messages.common.retry}
            </Button>
          }
        />
      </PageLayout>
    );
  }

  if (!template) {
    return (
      <PageLayout eyebrow={messages.common.eyebrow} title={copy.title}>
        <EmptyState title={copy.notFoundTitle} message={copy.notFoundMessage} />
      </PageLayout>
    );
  }

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow={messages.common.eyebrow} title={copy.title}>
        <ErrorState
          title={messages.common.adminRequiredTitle}
          message={messages.common.adminRequiredMessage}
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
      description={interpolate(copy.pageDescription, {
        channel: channelLabel(template.channel),
        version: template.version,
        state: stateLabel(template.state),
      })}
      actions={<div className="prompt-detail-actions">{actions}</div>}
    >
      {isMobile ? <DesktopOnlyBanner /> : null}

      {updateMutation.error ? (
        <Alert tone="error">{describeApiError(updateMutation.error, 'prompt-templates')}</Alert>
      ) : null}
      {publishMutation.error ? (
        <Alert tone="error">{describeApiError(publishMutation.error, 'prompt-templates')}</Alert>
      ) : null}
      {createMutation.error ? (
        <Alert tone="error">{describeApiError(createMutation.error, 'prompt-templates')}</Alert>
      ) : null}
      {revertMutation.error ? (
        <Alert tone="error">{describeApiError(revertMutation.error, 'prompt-templates')}</Alert>
      ) : null}
      {deleteMutation.error ? (
        <Alert tone="error">{describeApiError(deleteMutation.error, 'prompt-templates')}</Alert>
      ) : null}

      <div className="prompt-detail-layout">
        <section className="prompt-detail-editor">
          <div className="prompt-detail-header-strip">
            <StatusBadge tone={stateTone} withDot>
              {stateLabel(template.state)}
            </StatusBadge>
            <span className="mono-text">
              {interpolate(messages.common.versionTag, { version: template.version })}
            </span>
            <StatusBadge tone="neutral" compact>
              {channelLabel(template.channel)}
            </StatusBadge>
          </div>

          <KeyValueList
            items={[
              {
                id: 'key',
                label: copy.metadata.key,
                value: <span className="mono-text">{template.key}</span>,
              },
              {
                id: 'created',
                label: copy.metadata.created,
                value: (
                  <span title={format.dateTime(template.createdAt)}>
                    {template.createdBy !== null
                      ? interpolate(copy.metadata.createdBy, {
                          time: format.relativeTime(template.createdAt),
                          user: template.createdBy,
                        })
                      : format.relativeTime(template.createdAt)}
                  </span>
                ),
              },
              {
                id: 'updated',
                label: copy.metadata.updated,
                value: (
                  <span title={format.dateTime(template.updatedAt)}>
                    {format.relativeTime(template.updatedAt)}
                  </span>
                ),
              },
              template.publishedAt !== null
                ? {
                    id: 'published',
                    label: copy.metadata.published,
                    value: (
                      <span title={format.dateTime(template.publishedAt)}>
                        {format.relativeTime(template.publishedAt)}
                      </span>
                    ),
                  }
                : undefined,
            ].filter((item): item is NonNullable<typeof item> => item !== undefined)}
          />

          <Tabs defaultValue="system">
            <TabsList>
              <TabsTrigger value="system">{copy.tabs.system}</TabsTrigger>
              <TabsTrigger value="user">{copy.tabs.user}</TabsTrigger>
              <TabsTrigger value="variables">
                {interpolate(copy.tabs.variables, { n: format.number(variables.length) })}
              </TabsTrigger>
              <TabsTrigger value="preview">{copy.tabs.preview}</TabsTrigger>
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
              <p className="eyebrow">{copy.historyEyebrow}</p>
              <h3 className="section-title">{copy.historyTitle}</h3>
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
        title={interpolate(copy.publishConfirm.title, { version: template.version })}
        description={copy.publishConfirm.description}
        confirmLabel={
          publishMutation.isPending
            ? copy.publishConfirm.publishing
            : interpolate(copy.publishConfirm.confirm, { version: template.version })
        }
        isConfirming={publishMutation.isPending}
        onConfirm={() => void handlePublish()}
      />

      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title={interpolate(copy.discardConfirm.title, { version: template.version })}
        description={copy.discardConfirm.description}
        confirmLabel={
          deleteMutation.isPending ? copy.discardConfirm.discarding : copy.discardConfirm.confirm
        }
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
  const copy = getMessages('prompt-templates').promptTemplateDetailPage.actions;
  const buttons: ReactElement[] = [];
  if (args.state === 'draft') {
    buttons.push(
      <Button
        key="save"
        tone="primary"
        disabled={!args.canEdit || !args.isDirty || args.savePending}
        onClick={args.onSave}
      >
        {args.savePending ? copy.saving : copy.saveDraft}
      </Button>,
    );
    buttons.push(
      <Button
        key="publish"
        tone="secondary"
        disabled={!args.canEdit || args.isDirty}
        onClick={args.onPublish}
      >
        {interpolate(copy.publish, { version: args.version })}
      </Button>,
    );
    buttons.push(
      <Button key="discard" tone="ghost" disabled={!args.canEdit} onClick={args.onDiscard}>
        {copy.discardDraft}
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
        {args.createPending ? copy.creating : copy.newDraftFromVersion}
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
  const copy = useMessages('prompt-templates').promptTemplateDetailPage.variablesEditor;
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
    return <p className="muted-text">{copy.empty}</p>;
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
            placeholder={copy.namePlaceholder}
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
            <option value="string">{copy.types.string}</option>
            <option value="number">{copy.types.number}</option>
            <option value="object">{copy.types.object}</option>
            <option value="array">{copy.types.array}</option>
          </select>
          <label className="prompt-variables-editor__required">
            <input
              type="checkbox"
              checked={variable.required}
              disabled={!canEdit}
              onChange={(event) => updateVariable(index, { required: event.target.checked })}
            />
            {copy.required}
          </label>
          <input
            className="control"
            type="text"
            value={variable.description ?? ''}
            readOnly={!canEdit}
            placeholder={copy.descriptionPlaceholder}
            onChange={(event) => updateVariable(index, { description: event.target.value })}
          />
          {canEdit ? (
            <Button tone="ghost" onClick={() => removeVariable(index)}>
              {copy.remove}
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <Button tone="secondary" onClick={addVariable}>
          {copy.add}
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
  const copy = useMessages('prompt-templates').promptTemplateDetailPage.preview;
  const plural = usePlural();
  const format = useFormat();
  const sizeLabel = (text: string): string =>
    plural(text.length, copy.size, { tokens: format.number(Math.ceil(text.length / 4)) });
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
          <p className="eyebrow">{copy.sampleValues}</p>
          <Button tone="ghost" onClick={fillDemo}>
            {copy.fillDemo}
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
            {interpolate(copy.invalidJson, { error: parseResult.error })}
          </p>
        ) : null}
        {undeclaredPlaceholders.length > 0 ? (
          <Alert tone="warning" className="prompt-preview__undeclared">
            {copy.undeclared}{' '}
            {undeclaredPlaceholders.map((path) => (
              <code key={path} className="mono-text">{`{{${path}}} `}</code>
            ))}
          </Alert>
        ) : null}
      </div>

      <div className="prompt-preview__output">
        <article className="panel panel--dense">
          <header className="panel__header">
            <p className="eyebrow">{copy.systemPrompt}</p>
            <span className="panel__meta mono-text">{sizeLabel(systemPrompt)}</span>
          </header>
          {previewError && 'error' in previewError ? (
            <Alert tone="error">{previewError.error}</Alert>
          ) : previewError && 'systemPrompt' in previewError ? (
            <pre className="prompt-preview__rendered mono-text">{previewError.systemPrompt}</pre>
          ) : (
            <p className="muted-text">{copy.unavailable}</p>
          )}
        </article>

        <article className="panel panel--dense">
          <header className="panel__header">
            <p className="eyebrow">{copy.userPrompt}</p>
            <span className="panel__meta mono-text">{sizeLabel(userPromptTemplate)}</span>
          </header>
          {previewError && 'error' in previewError ? (
            <Alert tone="error">{previewError.error}</Alert>
          ) : previewError && 'userPrompt' in previewError ? (
            <pre className="prompt-preview__rendered mono-text">{previewError.userPrompt}</pre>
          ) : (
            <p className="muted-text">{copy.unavailable}</p>
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
  const messages = useMessages('prompt-templates');
  const copy = messages.promptTemplateDetailPage.history;
  const format = useFormat();
  if (isLoading) return <p className="muted-text">{copy.loading}</p>;
  if (versions.length === 0) return <p className="muted-text">{copy.empty}</p>;

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
              <span className="mono-text">
                {interpolate(messages.common.versionTag, { version: version.version })}
              </span>
              <StatusBadge tone={STATE_TONE[version.state]} compact>
                {stateLabel(version.state)}
              </StatusBadge>
              <span className="muted-text" title={format.dateTime(version.updatedAt)}>
                {format.relativeTime(version.updatedAt)}
              </span>
            </div>
            <div className="prompt-history-list__actions">
              {!isCurrent ? (
                <Button tone="ghost" onClick={() => onOpen(version)}>
                  {copy.open}
                </Button>
              ) : null}
              <Button tone="ghost" disabled={revertPending} onClick={() => onRevert(version)}>
                {copy.revert}
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
      return {
        ok: false,
        error: getMessages('prompt-templates').promptTemplateDetailPage.errors.sampleNotObject,
      };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          // eslint-disable-next-line no-restricted-syntax -- a local JSON.parse error, not an API error
          ? err.message
          : getMessages('prompt-templates').promptTemplateDetailPage.errors.invalidJson,
    };
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
    const copy = getMessages('prompt-templates').promptTemplateDetailPage.errors;
    if (err instanceof PromptTemplateRenderError) {
      return { error: interpolate(copy.missingRequired, { name: err.missingVariableName }) };
    }
    // eslint-disable-next-line no-restricted-syntax -- a local template render error, not an API error
    return { error: err instanceof Error ? err.message : copy.renderFailed };
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
