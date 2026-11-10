/**
 * Promotion page (#3935, mockups `promotions-detail` and `promotions-new`)
 *
 * `/promotions/new` starts from the benefit type and the templates;
 * `?copyOf=` starts the form from a saved promotion (Copy is how an ended
 * promotion is reused). `/promotions/:promotionId` opens a saved one. The
 * operator stays on the promotion after saving; a new one moves to its own
 * address so a reload, a copy of the link and the Results card all refer to it.
 *
 * @module apps/web/src/pages/promotions
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../shared/api/api-error';
import { useMessages } from '../../shared/i18n';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { useToast } from '../../shared/ui/toast-provider';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useVariantNames } from '../../features/gifts';
import { useDemoMode } from '../../features/system';
import { PromotionComposer } from '../../features/promotions/components/promotion-composer';
import { PromotionNew } from '../../features/promotions/components/promotion-new';
import { PromotionsGuide } from '../../features/promotions/components/promotions-guide';
import {
  useDeletePromotionMutation,
  usePromotionQuery,
  usePromotionsQuery,
  useResumePromotionMutation,
  useSavePromotionMutation,
} from '../../features/promotions/hooks/use-promotions';
import {
  emptyPromotionForm,
  formToWriteInput,
  promotionToForm,
  type PromotionFormValues,
} from '../../features/promotions/lib/promotion-form';
import { describeApiError } from '../../shared/api/describe-api-error';

const isNotFoundError = (error: Error): boolean => error instanceof ApiError && error.isNotFound();

export function PromotionPage(): ReactElement {
  return (
    <PromotionsGuide>
      <PromotionPageContent />
    </PromotionsGuide>
  );
}

function PromotionPageContent(): ReactElement {
  const copy = useMessages('promotions');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { promotionId = 'new' } = useParams();
  const [search] = useSearchParams();
  const demoMode = useDemoMode();
  const write = useWriteAccess('gifts:write', demoMode);
  const save = useSavePromotionMutation();
  const resume = useResumePromotionMutation();
  const remove = useDeletePromotionMutation();
  const all = usePromotionsQuery();
  const [savedCount, setSavedCount] = useState(0);

  const isNew = promotionId === 'new';
  const copyOf = search.get('copyOf');
  const sourceId = isNew ? copyOf : promotionId;
  const promotion = usePromotionQuery(sourceId);
  const names = useVariantNames([
    promotion.data?.benefit.variantId ?? '',
    ...(promotion.data?.conditions.flatMap((c) =>
      c.field === 'containsProduct' ? [c.value] : []
    ) ?? []),
  ]);

  const initial = useMemo<PromotionFormValues | null>(() => {
    if (promotion.data === undefined) return null;
    const values = promotionToForm(promotion.data, names);
    if (!isNew) return values;
    const fresh = emptyPromotionForm(values.kind);
    return {
      ...values,
      name: `${values.name} ${copy.detail.copySuffix}`,
      from: fresh.from,
      to: '',
      combineIds: [],
      combineMode: values.combineMode === 'selected' ? 'all' : values.combineMode,
    };
  }, [promotion.data, names, isNew, copy.detail.copySuffix]);

  const onSaved = (): void => {
    setSavedCount((n) => n + 1);
    showToast({ tone: 'success', title: copy.detail.savedToast, description: '' });
  };

  const onSave = (values: PromotionFormValues, isActive: boolean): void => {
    save.mutate(
      { id: isNew ? null : promotionId, input: formToWriteInput(values, isActive) },
      {
        onSuccess: (result) => {
          onSaved();
          if (isNew)
            void navigate(`/promotions/${encodeURIComponent(result.id)}`, { replace: true });
        },
      }
    );
  };

  const header = {
    eyebrow: copy.detail.eyebrow,
    backTo: { to: '/promotions', label: copy.page.back, 'data-testid': 'promotion-back' },
  };

  if (isNew) {
    if (copyOf !== null && promotion.isLoading) {
      return (
        <PageLayout {...header} title={copy.new.title}>
          <LoadingState title={copy.page.loading} message="" />
        </PageLayout>
      );
    }
    return (
      <PromotionNew
        // A copy starts from the saved one; without `copyOf` it starts from the templates.
        key={copyOf ?? 'blank'}
        initial={copyOf !== null && initial !== null ? initial : undefined}
        all={all.data ?? []}
        canWrite={write.canWrite}
        saving={save.isPending}
        savedCount={savedCount}
        saveError={save.isError ? describeApiError(save.error, 'promotions') : null}
        onSave={onSave}
      />
    );
  }

  if (promotion.isLoading || initial === null) {
    if (promotion.isError) {
      return (
        <PageLayout {...header} title={copy.detail.eyebrow}>
          <ErrorState
            title={copy.detail.loadFailed}
            message={
              isNotFoundError(promotion.error)
                ? copy.detail.notFound
                : describeApiError(promotion.error, 'promotions')
            }
          />
        </PageLayout>
      );
    }
    return (
      <PageLayout {...header} title={copy.detail.eyebrow}>
        <LoadingState title={copy.page.loading} message="" />
      </PageLayout>
    );
  }

  return (
    <PromotionComposer
      initial={initial}
      promotion={promotion.data as NonNullable<typeof promotion.data>}
      all={all.data ?? []}
      canWrite={write.canWrite}
      saving={save.isPending || resume.isPending}
      savedCount={savedCount}
      saveError={
        save.isError
          ? describeApiError(save.error, 'promotions')
          : resume.isError
            ? describeApiError(resume.error, 'promotions')
            : remove.isError
              ? `${copy.page.deleteFailed} ${describeApiError(remove.error, 'promotions')}`
              : null
      }
      onSave={(values, isActive, extend) => {
        onSave(extend ? { ...values, to: extend.to } : values, isActive);
      }}
      onResume={(additionalUnits) => {
        resume.mutate({ id: promotionId, additionalUnits }, { onSuccess: onSaved });
      }}
      onDelete={
        write.canWrite
          ? (): void => {
              remove.mutate(promotionId, {
                onSuccess: () => {
                  showToast({ tone: 'success', title: copy.detail.deleted, description: '' });
                  void navigate('/promotions');
                },
              });
            }
          : undefined
      }
      deleting={remove.isPending}
      onCopy={() => {
        void navigate(`/promotions/new?copyOf=${encodeURIComponent(promotionId)}`);
      }}
    />
  );
}
