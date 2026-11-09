/**
 * Gift report for the promotions pages (#3935)
 *
 * The last 30 days of gifts the promotions gave, from the same read the gift
 * report page uses. The window is fixed when the page mounts, so the query key
 * does not change under a re-render across midnight.
 *
 * @module apps/web/src/features/gifts/hooks
 */
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useGiftReportQuery, type GiftReport, type GiftReportFilters } from '../../gift-report';

const WINDOW_DAYS = 30;

const day = (date: Date): string => date.toISOString().slice(0, 10);

export function useGiftRuleReportQuery(enabled = true): UseQueryResult<GiftReport> {
  const filters = useMemo<GiftReportFilters>(() => {
    const to = new Date();
    const from = new Date(to.getTime() - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    return { from: day(from), to: day(to), giftSource: 'rule' };
  }, []);
  return useGiftReportQuery(filters, { enabled });
}
