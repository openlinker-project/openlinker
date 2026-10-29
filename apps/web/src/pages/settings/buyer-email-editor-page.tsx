/**
 * Buyer Email Template Editor (#3555, mockup M21 `editor` / `editor-sent`)
 *
 * One template on one connection: the switch, sender and reply-to (this
 * connection only) and the subject and message (shared by every connection,
 * which the page says). Variables insert into the message; the preview fills
 * them with sample values; "Send test email" sends the text as typed to the
 * operator's own address through the real mail transport, and is never
 * recorded on an order.
 *
 * @module apps/web/src/pages/settings
 */
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { FormField } from '../../shared/ui/form-field';
import { Input } from '../../shared/ui/input';
import { Textarea } from '../../shared/ui/textarea';
import { LoadingState } from '../../shared/ui/feedback-state';
import { useToast } from '../../shared/ui/toast-provider';
import { useIsAdmin } from '../../shared/auth/use-permission';
import { useConnectionQuery, type Connection } from '../../features/connections';
import type { AutomationRule } from '../../features/automation';
import {
  BUYER_EMAILS_COPY,
  BUYER_EMAIL_MERGE_FIELDS,
  BUYER_EMAIL_TEMPLATE_COPY,
  channelKindOf,
  isBuyerEmailTemplate,
  isSingleEmailAddress,
  isTemplateAllowed,
  readBuyerEmailsSettings,
  readRuleWording,
  renderPreview,
  useBuyerEmailRules,
  useSaveBuyerEmailTemplateMutation,
  useSendBuyerEmailTestMutation,
  type BuyerEmailTemplate,
} from '../../features/buyer-emails';

const COPY = BUYER_EMAILS_COPY.editor;

function addressError(value: string): string | undefined {
  return value.trim() === '' || isSingleEmailAddress(value.trim()) ? undefined : COPY.invalidAddress;
}

function EditorForm({
  connection,
  template,
  rule,
}: {
  connection: Connection;
  template: BuyerEmailTemplate;
  rule: AutomationRule | null;
}): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const save = useSaveBuyerEmailTemplateMutation();
  const sendTest = useSendBuyerEmailTestMutation();
  const enabledId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const listUrl = `/settings/buyer-emails?connection=${encodeURIComponent(connection.id)}`;

  const current = readBuyerEmailsSettings(connection.config).templates[template];
  const wording = rule ? readRuleWording(rule) : { subject: '', body: '' };
  const [enabled, setEnabled] = useState(current?.enabled === true);
  const [fromAddress, setFromAddress] = useState(current?.fromAddress ?? '');
  const [replyTo, setReplyTo] = useState(current?.replyTo ?? '');
  const [subject, setSubject] = useState(wording.subject);
  const [body, setBody] = useState(wording.body);
  const [testTo, setTestTo] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  const fromError = addressError(fromAddress);
  const replyToError = addressError(replyTo);
  const testToError = testTo.trim() === '' ? undefined : addressError(testTo);

  function insertVariable(field: string): void {
    const token = `{${field}}`;
    const element = bodyRef.current;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
  }

  function handleSave(event: FormEvent): void {
    event.preventDefault();
    if (fromError || replyToError) return;
    save.mutate(
      {
        connectionId: connection.id,
        connectionConfig: connection.config,
        template,
        settings: { enabled, fromAddress, replyTo },
        rule,
        wording: { subject, body },
      },
      {
        onSuccess: () => {
          showToast({ description: BUYER_EMAILS_COPY.page.saved, tone: 'success' });
          void navigate(listUrl);
        },
        onError: (error) => showToast({ description: error.message, tone: 'error' }),
      },
    );
  }

  function handleSendTest(): void {
    const to = testTo.trim();
    if (!isSingleEmailAddress(to)) return;
    setSentTo(null);
    sendTest.mutate(
      { connectionId: connection.id, templateKey: template, to, subject, body },
      {
        onSuccess: () => setSentTo(to),
        onError: (error) => showToast({ description: error.message, tone: 'error' }),
      },
    );
  }

  return (
    <div
      className="buyer-email-editor"
      data-mk-state={sentTo ? 'editor-sent' : 'editor'}
      data-testid="buyer-email-editor"
    >
      <form className="buyer-email-editor__form panel panel--dense" onSubmit={handleSave}>
        <p className="muted-text">{BUYER_EMAIL_TEMPLATE_COPY[template].description}</p>

        <label className="buyer-emails-switch" htmlFor={enabledId}>
          <input
            id={enabledId}
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            data-testid="buyer-email-template-enabled"
          />
          <span>{COPY.enabledLabel}</span>
        </label>

        <FormField label={COPY.fromLabel} name="fromAddress" description={COPY.fromHint} error={fromError}>
          <Input
            type="email"
            value={fromAddress}
            onChange={(event) => setFromAddress(event.target.value)}
            data-testid="buyer-email-from"
          />
        </FormField>
        <FormField label={COPY.replyToLabel} name="replyTo" error={replyToError}>
          <Input
            type="email"
            value={replyTo}
            onChange={(event) => setReplyTo(event.target.value)}
            data-testid="buyer-email-reply-to"
          />
        </FormField>

        <Alert tone="info" density="compact">
          {COPY.sharedWording}
        </Alert>
        {rule ? null : <Alert tone="warning">{COPY.noRule}</Alert>}

        <FormField label={COPY.subjectLabel} name="subject">
          <Input
            value={subject}
            disabled={!rule}
            onChange={(event) => setSubject(event.target.value)}
            data-testid="buyer-email-subject"
          />
        </FormField>
        <FormField label={COPY.bodyLabel} name="body">
          <Textarea
            ref={bodyRef}
            rows={8}
            value={body}
            disabled={!rule}
            onChange={(event) => setBody(event.target.value)}
            data-testid="buyer-email-body"
          />
        </FormField>

        <div>
          <p className="eyebrow">{COPY.variablesTitle}</p>
          <p className="muted-text">{COPY.variablesHint}</p>
          <div className="buyer-email-editor__variables" data-testid="buyer-email-variables">
            {BUYER_EMAIL_MERGE_FIELDS.map((field) => (
              <Button
                key={field}
                type="button"
                tone="secondary"
                className="button--sm"
                disabled={!rule}
                onClick={() => insertVariable(field)}
              >
                {`{${field}}`}
              </Button>
            ))}
          </div>
        </div>

        <div className="buyer-email-editor__actions">
          <Button type="submit" disabled={save.isPending || Boolean(fromError || replyToError)} data-testid="buyer-email-save">
            {COPY.save}
          </Button>
          <Button type="button" tone="secondary" onClick={() => void navigate(listUrl)}>
            {COPY.cancel}
          </Button>
        </div>
      </form>

      <aside className="buyer-email-editor__form">
        <section className="panel panel--dense" data-testid="buyer-email-preview">
          <p className="eyebrow">{COPY.previewTitle}</p>
          <strong>{renderPreview(subject)}</strong>
          <p className="buyer-email-editor__preview">{renderPreview(body)}</p>
        </section>

        <section className="panel panel--dense" data-testid="buyer-email-test">
          <p className="eyebrow">{COPY.testTitle}</p>
          <FormField label={COPY.testToLabel} name="testTo" error={testToError}>
            <Input
              type="email"
              value={testTo}
              onChange={(event) => setTestTo(event.target.value)}
              data-testid="buyer-email-test-to"
            />
          </FormField>
          <Button
            type="button"
            tone="secondary"
            disabled={sendTest.isPending || !isSingleEmailAddress(testTo.trim()) || body.trim() === ''}
            onClick={handleSendTest}
            data-testid="buyer-email-test-send"
          >
            {COPY.testSend}
          </Button>
          {sentTo ? (
            <Alert tone="success" title={COPY.testSent(sentTo)} data-testid="buyer-email-test-sent">
              {COPY.testSentDetail}
            </Alert>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

export function BuyerEmailEditorPage(): ReactElement {
  const isAdmin = useIsAdmin();
  const { connectionId = '', template = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId, { enabled: connectionId !== '' });
  const rules = useBuyerEmailRules();
  const known = isBuyerEmailTemplate(template);
  const title = known ? BUYER_EMAIL_TEMPLATE_COPY[template].label : BUYER_EMAILS_COPY.page.title;
  const backTo = {
    to: `/settings/buyer-emails?connection=${encodeURIComponent(connectionId)}`,
    label: COPY.back,
  };

  let content: ReactElement;
  if (!isAdmin) {
    content = <Alert tone="info">Only an administrator can change buyer emails.</Alert>;
  } else if (!known) {
    content = <Alert tone="error">{BUYER_EMAILS_COPY.page.loadError}</Alert>;
  } else if (connectionQuery.isLoading || rules.isLoading) {
    content = <LoadingState liveRegion="off" title={title} message="Loading…" />;
  } else if (connectionQuery.isError || !connectionQuery.data) {
    content = <Alert tone="error">{BUYER_EMAILS_COPY.page.loadError}</Alert>;
  } else if (!isTemplateAllowed(template, channelKindOf(connectionQuery.data.enabledCapabilities))) {
    content = <Alert tone="info">{COPY.notAllowed}</Alert>;
  } else {
    content = (
      <EditorForm
        key={`${connectionQuery.data.id}:${template}`}
        connection={connectionQuery.data}
        template={template}
        rule={rules.rules[template]}
      />
    );
  }

  return (
    <PageLayout backTo={backTo} eyebrow={connectionQuery.data?.name ?? 'Settings'} title={title}>
      {content}
    </PageLayout>
  );
}
