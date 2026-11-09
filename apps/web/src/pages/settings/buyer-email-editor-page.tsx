/**
 * Buyer Email Template Editor (#3555, mockup M21 `editor` / `editor-sent`)
 *
 * One template on one connection: the switch, sender and reply-to (this
 * connection only) and the subject and message (shared by every connection,
 * which the page says). Variables insert into the message; the preview fills
 * them with sample values; "Send test email" sends exactly that preview - the
 * same sample values, never raw `{field}` tokens - to the address the operator
 * types (their own by default) through the real mail transport, and is never
 * recorded on an order.
 *
 * The draft lives in React Hook Form with a Zod schema (frontend-architecture
 * § Form State). The test send uses the draft wording but the SAVED sender
 * (the server never takes a `from` from the browser), so it is blocked while
 * the sender or reply-to has unsaved edits - otherwise the operator would test
 * an address that is not the one on screen. A template whose seeded rule is
 * missing cannot be switched on: with no rule nothing fires, so an "on" switch
 * would promise an email that never goes out.
 *
 * @module apps/web/src/pages/settings
 */
import { useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { FormField } from '../../shared/ui/form-field';
import { Input } from '../../shared/ui/input';
import { Textarea } from '../../shared/ui/textarea';
import { AccessDeniedState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { AccessGate } from '../../shared/ui/access-gate';
import { useToast } from '../../shared/ui/toast-provider';
import { useSession } from '../../shared/auth/use-session';
import { useConnectionQuery, type Connection } from '../../features/connections';
import type { AutomationRule } from '../../features/automation';
import { interpolate, useActiveLocale, useMessages } from '../../shared/i18n';
import {
  BUYER_EMAIL_MERGE_FIELDS,
  buildBuyerEmailEditorSchema,
  buildBuyerEmailTestFormSchema,
  channelKindOf,
  isBuyerEmailTemplate,
  isBuyerEmailTestRateLimitedError,
  isTemplateAllowed,
  readBuyerEmailsSettings,
  readRuleWording,
  renderPreview,
  templateCopy,
  useBuyerEmailRules,
  useSaveBuyerEmailTemplateMutation,
  useSendBuyerEmailTestMutation,
  type BuyerEmailEditorFormValues,
  type BuyerEmailTemplate,
  type BuyerEmailTestFormValues,
} from '../../features/buyer-emails';

function EditorForm({
  connection,
  template,
  rule,
}: {
  connection: Connection;
  template: BuyerEmailTemplate;
  rule: AutomationRule | null;
}): ReactElement {
  const messages = useMessages('buyer-emails');
  const COPY = messages.editor;
  const locale = useActiveLocale();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { session } = useSession();
  const save = useSaveBuyerEmailTemplateMutation();
  const sendTest = useSendBuyerEmailTestMutation();
  const enabledId = useId();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const listUrl = `/settings/buyer-emails?connection=${encodeURIComponent(connection.id)}`;
  const wordingEditable = rule !== null;

  const current = readBuyerEmailsSettings(connection.config).templates[template];
  const wording = rule ? readRuleWording(rule) : { subject: '', body: '' };
  // Rebuilt when the language changes, so the validation messages follow it.
  const schema = useMemo(
    () => buildBuyerEmailEditorSchema({ wordingEditable }),
    [wordingEditable, locale],
  );
  const testSchema = useMemo(() => buildBuyerEmailTestFormSchema(), [locale]);
  const form = useForm<BuyerEmailEditorFormValues>({
    defaultValues: {
      // A template with no rule cannot send, so it is never shown as switched on.
      enabled: wordingEditable && current?.enabled === true,
      fromAddress: current?.fromAddress ?? '',
      replyTo: current?.replyTo ?? '',
      subject: wording.subject,
      body: wording.body,
    },
    resolver: zodResolver(schema),
    mode: 'onChange',
  });
  // The test send defaults to the operator's own address: the test is for them.
  const testForm = useForm<BuyerEmailTestFormValues>({
    defaultValues: { to: session.user?.email ?? '' },
    resolver: zodResolver(testSchema),
    mode: 'onChange',
  });
  const [sentTo, setSentTo] = useState<string | null>(null);

  const subject = useWatch({ control: form.control, name: 'subject' }) ?? '';
  const body = useWatch({ control: form.control, name: 'body' }) ?? '';
  const { errors, dirtyFields } = form.formState;
  const senderUnsaved = dirtyFields.fromAddress === true || dirtyFields.replyTo === true;
  const bodyField = form.register('body');

  function insertVariable(field: string): void {
    const token = `{${field}}`;
    const element = bodyRef.current;
    const value = form.getValues('body') ?? '';
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    form.setValue('body', value.slice(0, start) + token + value.slice(end), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  const onSave = form.handleSubmit((values) => {
    save.mutate(
      {
        connectionId: connection.id,
        template,
        settings: {
          enabled: wordingEditable && values.enabled === true,
          fromAddress: values.fromAddress,
          replyTo: values.replyTo,
        },
        rule,
        wording: { subject: values.subject ?? '', body: values.body ?? '' },
      },
      {
        onSuccess: () => {
          showToast({ description: messages.page.saved, tone: 'success' });
          void navigate(listUrl);
        },
        onError: (error) => {
          // The connection write went through before the wording failed, so
          // the sender on screen IS the saved one: stop treating it as unsaved,
          // or the test send stays blocked behind a "save first" that is false.
          if (error.stage === 'wording') {
            form.resetField('fromAddress', { defaultValue: values.fromAddress });
            form.resetField('replyTo', { defaultValue: values.replyTo });
          }
          showToast({ description: error.message, tone: 'error' });
        },
      },
    );
  });

  const onSendTest = testForm.handleSubmit(({ to }) => {
    const address = to.trim();
    setSentTo(null);
    sendTest.mutate(
      {
        connectionId: connection.id,
        templateKey: template,
        to: address,
        // The test is what the preview shows: an operator checking a template
        // must not receive literal `{order.reference}` tokens a buyer never sees.
        subject: renderPreview(subject),
        body: renderPreview(body),
      },
      {
        onSuccess: () => setSentTo(address),
        onError: (error) =>
          showToast({
            description: isBuyerEmailTestRateLimitedError(error) ? COPY.testRateLimited : error.message,
            tone: 'error',
          }),
      },
    );
  });

  return (
    <div
      className="buyer-email-editor"
      data-mk-state={sentTo ? 'editor-sent' : 'editor'}
      data-testid="buyer-email-editor"
    >
      <form className="buyer-email-editor__form panel panel--dense" onSubmit={(event) => void onSave(event)} noValidate>
        <p className="muted-text">{templateCopy(template).description}</p>

        <label className="buyer-emails-switch" htmlFor={enabledId}>
          <input
            id={enabledId}
            type="checkbox"
            disabled={!wordingEditable}
            {...form.register('enabled')}
            data-testid="buyer-email-template-enabled"
          />
          <span>{COPY.enabledLabel}</span>
        </label>

        <FormField
          label={COPY.fromLabel}
          name="fromAddress"
          description={COPY.fromHint}
          error={errors.fromAddress?.message}
        >
          <Input
            type="email"
            {...form.register('fromAddress')}
            invalid={Boolean(errors.fromAddress)}
            data-testid="buyer-email-from"
          />
        </FormField>
        <FormField label={COPY.replyToLabel} name="replyTo" error={errors.replyTo?.message}>
          <Input
            type="email"
            {...form.register('replyTo')}
            invalid={Boolean(errors.replyTo)}
            data-testid="buyer-email-reply-to"
          />
        </FormField>

        <Alert tone="info" density="compact">
          {COPY.sharedWording}
        </Alert>
        {wordingEditable ? null : <Alert tone="warning">{COPY.noRule}</Alert>}

        <FormField label={COPY.subjectLabel} name="subject" error={errors.subject?.message}>
          <Input
            {...form.register('subject')}
            disabled={!wordingEditable}
            invalid={Boolean(errors.subject)}
            data-testid="buyer-email-subject"
          />
        </FormField>
        <FormField label={COPY.bodyLabel} name="body" error={errors.body?.message}>
          <Textarea
            {...bodyField}
            ref={(element) => {
              bodyField.ref(element);
              bodyRef.current = element;
            }}
            rows={8}
            disabled={!wordingEditable}
            invalid={Boolean(errors.body)}
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
                disabled={!wordingEditable}
                onClick={() => insertVariable(field)}
              >
                {`{${field}}`}
              </Button>
            ))}
          </div>
        </div>

        <div className="buyer-email-editor__actions">
          <Button type="submit" disabled={save.isPending} data-testid="buyer-email-save">
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

        <form
          className="panel panel--dense"
          data-testid="buyer-email-test"
          onSubmit={(event) => void onSendTest(event)}
          noValidate
        >
          <p className="eyebrow">{COPY.testTitle}</p>
          <FormField label={COPY.testToLabel} name="testTo" error={testForm.formState.errors.to?.message}>
            <Input
              type="email"
              {...testForm.register('to')}
              invalid={Boolean(testForm.formState.errors.to)}
              data-testid="buyer-email-test-to"
            />
          </FormField>
          <Button
            type="submit"
            tone="secondary"
            disabled={
              sendTest.isPending || senderUnsaved || subject.trim() === '' || body.trim() === ''
            }
            data-testid="buyer-email-test-send"
          >
            {COPY.testSend}
          </Button>
          {senderUnsaved ? (
            <p className="muted-text" data-testid="buyer-email-test-sender-unsaved">
              {COPY.testSenderUnsaved}
            </p>
          ) : null}
          {sentTo ? (
            <Alert tone="success" title={interpolate(COPY.testSent, { to: sentTo })} data-testid="buyer-email-test-sent">
              {COPY.testSentDetail}
            </Alert>
          ) : null}
        </form>
      </aside>
    </div>
  );
}

export function BuyerEmailEditorPage(): ReactElement {
  const messages = useMessages('buyer-emails');
  const COPY = messages.editor;
  const { connectionId = '', template = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId, { enabled: connectionId !== '' });
  const known = isBuyerEmailTemplate(template);
  // Only this template's rule: the editor reads one, the list reads all four.
  const rules = useBuyerEmailRules(known ? template : undefined);
  const title = known ? templateCopy(template).label : messages.page.title;
  const backTo = {
    to: `/settings/buyer-emails?connection=${encodeURIComponent(connectionId)}`,
    label: COPY.back,
  };

  let content: ReactElement;
  if (!known) {
    content = <Alert tone="error">{messages.page.loadError}</Alert>;
  } else if (connectionQuery.isLoading || rules.isLoading) {
    content = <LoadingState liveRegion="off" title={title} message={COPY.loading} />;
  } else if (connectionQuery.isError || !connectionQuery.data) {
    content = <Alert tone="error">{messages.page.loadError}</Alert>;
  } else if (rules.isError) {
    // Checked before the editor renders: a failed read leaves every rule
    // `null`, and the editor would then claim the rule is missing.
    content = (
      <ErrorState
        title={COPY.rulesLoadErrorTitle}
        message={COPY.rulesLoadError}
        action={
          <Button tone="secondary" onClick={rules.refetch} data-testid="buyer-email-rules-retry">
            {COPY.retry}
          </Button>
        }
      />
    );
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
    <PageLayout backTo={backTo} eyebrow={connectionQuery.data?.name ?? COPY.eyebrow} title={title}>
      {/* Same gate as the list page: only an administrator holds `connections:write`. */}
      <AccessGate
        require="connections:write"
        fallback={<AccessDeniedState message={messages.page.adminOnly} />}
      >
        {content}
      </AccessGate>
    </PageLayout>
  );
}
