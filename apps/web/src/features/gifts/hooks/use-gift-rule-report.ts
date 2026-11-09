/**
 * Gift report for the promotions pages (#3935)
 *
 * The last 30 days of gifts the promotions gave, from the same read the gift
 * report page uses. The window is derived from today's date, so it rolls over at
 * midnight while the query key stays the same for the whole day.
 *
 * @module apps/web/src/features/gifts/hooks
 */
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useGiftReportQuery, type GiftReport, type GiftReportFilters } from '../../gift-report';

const WINDOW_DAYS = 30;

const day = (date: Date): string => date.toISOString().slice(0, 10);

export function useGiftRuleReportQuery(enabled = true): UseQueryResult<GiftReport> {
  const today = day(new Date());
  const filters = useMemo<GiftReportFilters>(() => {
    const to = new Date(`${today}T00:00:00.000Z`);
    const from = new Date(to.getTime() - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    return { from: day(from), to: today, giftSource: 'rule' };
  }, [today]);
  return useGiftReportQuery(filters, { enabled });
}
