/**
 * Gift promotion composer page (#3940, mockup M31 `promotions/new-template`,
 * `composer-*`, `active`, `paused-*`, `ended`)
 *
 * `/automations/gifts/new` starts from three cards; `?type=` skips them (the
 * cards link back with it). `/automations/gifts/:ruleId` opens a saved one.
 * `?copyOf=` starts a new one from a saved one: Copy is how an ended promotion
 * is reused.
 *
 * @module apps/web/src/pages/gifts
 */
import { useMemo, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { useToast } from '../../shared/ui/toast-provider';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import {
  GiftRuleComposer,
  GiftRuleKindValues,
  GiftRuleTemplateCards,
  emptyGiftRuleForm,
  formToWriteInput,
  ruleToForm,
  useGiftRuleQuery,
  useDeleteGiftRuleMutation,
  useResumeGiftRuleMutation,
  useSaveGiftRuleMutation,
  useVariantNames,
  type GiftRuleFormValues,
  type GiftRuleKind,
} from '../../features/gifts';

function readKind(value: string | null): GiftRuleKind | null {
  return (GiftRuleKindValues as readonly string[]).includes(value ?? '') ? (value as GiftRuleKind) : null;
}

export function GiftRulePage(): ReactElement {
  const copy = useMessages('gifts');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { ruleId = 'new' } = useParams();
  const [search, setSearch] = useSearchParams();
  const demoMode = useDemoMode();
  const write = useWriteAccess('gifts:write', demoMode);
  const save = useSaveGiftRuleMutation();
  const resume = useResumeGiftRuleMutation();
  const remove = useDeleteGiftRuleMutation();

  const isNew = ruleId === 'new';
  const copyOf = search.get('copyOf');
  const sourceId = isNew ? copyOf : ruleId;
  const rule = useGiftRuleQuery(sourceId);
  const names = useVariantNames([
    rule.data?.gift?.variantId ?? '',
    ...(rule.data?.conditions.flatMap((c) => (c.field === 'containsProduct' ? [c.value] : [])) ?? []),
  ]);

  const initial = useMemo<GiftRuleFormValues | null>(() => {
    if (rule.data !== undefined) {
      const values = ruleToForm(rule.data, names);
      if (isNew) {
        const fresh = emptyGiftRuleForm(values.kind);
        return { ...values, name: `${values.name} ${copy.composer.copySuffix}`, from: fresh.from, to: '' };
      }
      return values;
    }
    const kind = readKind(search.get('type'));
    return kind === null || sourceId !== null ? null : emptyGiftRuleForm(kind);
  }, [rule.data, names, isNew, search, sourceId, copy.composer.copySuffix]);

  const saved = (): void => {
    showToast({ tone: 'success', title: copy.composer.saved, description: '' });
    void navigate('/automations/gifts');
  };

  const onSave = (
    values: GiftRuleFormValues,
    isActive: boolean,
    extend?: { to: string },
  ): void => {
    const input = formToWriteInput(extend ? { ...values, to: extend.to } : values, isActive);
    save.mutate({ ruleId: isNew ? null : ruleId, input }, { onSuccess: saved });
  };

  const header = {
    eyebrow: copy.list.eyebrow,
    backTo: {
      to: '/automations/gifts',
      label: copy.composer.back,
      'data-testid': 'gift-composer-back',
    },
  };

  if (sourceId !== null && rule.isLoading) {
    return (
      <PageLayout {...header} title={copy.composer.title}>
        <LoadingState title={copy.list.loading} message="" />
      </PageLayout>
    );
  }
  if (sourceId !== null && rule.isError) {
    return (
      <PageLayout {...header} title={copy.composer.title}>
        <ErrorState title={copy.composer.loadFailed} message={rule.error.message} />
      </PageLayout>
    );
  }
  if (initial === null) {
    return (
      <PageLayout {...header} title={<span data-testid="gift-composer-template-heading">{copy.composer.newTitle}</span>}>
        <GiftRuleTemplateCards onChoose={(kind) => setSearch({ type: kind })} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      {...header}
      title={<span data-testid="gift-composer-title">{isNew ? copy.composer.newTitle : (rule.data?.name ?? copy.composer.title)}</span>}
    >
      <GiftRuleComposer
        initial={initial}
        rule={isNew ? null : (rule.data ?? null)}
        canWrite={write.canWrite}
        saving={save.isPending || resume.isPending}
        saveError={
          save.isError
            ? save.error.message
            : resume.isError
              ? resume.error.message
              : remove.isError
                ? `${copy.composer.deleteFailed}: ${remove.error.message}`
                : null
        }
        onSave={onSave}
        onResume={(additionalUnits) =>
          resume.mutate({ ruleId, additionalUnits }, { onSuccess: saved })
        }
        onDelete={
          write.canWrite && !isNew
            ? () =>
                remove.mutate(ruleId, {
                  onSuccess: () => {
                    showToast({ tone: 'success', title: copy.composer.deleted, description: '' });
                    void navigate('/automations/gifts');
                  },
                })
            : undefined
        }
        deleting={remove.isPending}
        onCopy={() => void navigate(`/automations/gifts/new?copyOf=${encodeURIComponent(ruleId)}`)}
      />
    </PageLayout>
  );
}
