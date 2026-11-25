/**
 * Returns list config (#4241)
 *
 * What the Returns list declares to the saved-views engine: the filters a view
 * may carry, the built-in views (the worklist segments, spec 4.1) and the column
 * registry. The API has no sort for returns, so the list declares none and the
 * engine keeps `sort` out of the address.
 *
 * Cell renderers belong to the page, so the registry is a factory taking them.
 *
 * @module apps/web/src/features/returns/lib
 */
import type { ReactNode } from 'react';
import type { ListRegistry, SystemViewDef } from '../../saved-views';
import { withColumnLayout } from '../../saved-views';
import { isReturnBucket, isReturnLineReason, isReturnMoneyState, type ReturnListItem } from '../api/returns.types';
import { RETURN_SEGMENT_TONES, RETURN_SEGMENT_VALUES, isReturnSegment, type ReturnSegment } from './return-segments';
import { isReturnStage } from './return-stage.types';

/** Id of the built-in view that clears the segment. */
export const ALL_RETURNS_VIEW_ID = 'all';

/**
 * Narrower header breakpoints the table already used; the registry has no
 * notion of them, so the page re-applies them after the engine builds columns.
 */
const RETURN_COLUMN_HIDE_BELOW: Record<string, 480 | 768 | 1024 | 1280> = {
  source: 1024,
  opened: 768,
  sourceStatus: 768,
};

export interface ReturnsListConfigInput {
  labels: {
    return: string;
    returnFields: string;
    order: string;
    orderFields: string;
    source: string;
    sourceFields: string;
    opened: string;
    sourceStatus: string;
    stage: string;
    stageFields: string;
  };
  /** Operator names of the built-in views: `all` plus one per segment. */
  viewNames: Record<'all' | ReturnSegment, string>;
  headers: {
    return: ReactNode;
    order: ReactNode;
    source: ReactNode;
    opened: ReactNode;
    sourceStatus: ReactNode;
    stage: ReactNode;
  };
  cells: {
    return: (row: ReturnListItem) => ReactNode;
    order: (row: ReturnListItem) => ReactNode;
    source: (row: ReturnListItem) => ReactNode;
    opened: (row: ReturnListItem) => ReactNode;
    sourceStatus: (row: ReturnListItem) => ReactNode;
    stage: (row: ReturnListItem) => ReactNode;
  };
}

export function returnsSystemViews(names: ReturnsListConfigInput['viewNames']): SystemViewDef[] {
  return [
    { id: ALL_RETURNS_VIEW_ID, name: names.all, query: '' },
    ...RETURN_SEGMENT_VALUES.map(
      (segment): SystemViewDef => {
        const tone = RETURN_SEGMENT_TONES[segment];
        return {
          id: segment,
          name: names[segment],
          query: `segment=${segment}`,
          tone: tone === 'error' || tone === 'warning' ? tone : undefined,
        };
      },
    ),
  ];
}

export function createReturnsListRegistry(input: ReturnsListConfigInput): ListRegistry<ReturnListItem> {
  const { labels, headers, cells } = input;
  return {
    pageKey: 'returns',
    locked: {
      id: 'return',
      label: labels.return,
      description: labels.returnFields,
      header: headers.return,
      render: cells.return,
    },
    columns: withColumnLayout([
      { id: 'order', label: labels.order, description: labels.orderFields, defaultVisible: true, header: headers.order, render: cells.order },
      { id: 'source', label: labels.source, description: labels.sourceFields, defaultVisible: true, header: headers.source, render: cells.source },
      { id: 'opened', label: labels.opened, defaultVisible: true, header: headers.opened, render: cells.opened },
      { id: 'sourceStatus', label: labels.sourceStatus, defaultVisible: true, header: headers.sourceStatus, render: cells.sourceStatus },
      { id: 'stage', label: labels.stage, description: labels.stageFields, defaultVisible: true, header: headers.stage, render: cells.stage },
    ], { hideBelow: RETURN_COLUMN_HIDE_BELOW }),
    filters: [
      { key: 'segment', parse: (raw) => isReturnSegment(raw) },
      { key: 'bucket', parse: (raw) => isReturnBucket(raw) },
      { key: 'stage', parse: (raw) => isReturnStage(raw) },
      { key: 'money', parse: (raw) => isReturnMoneyState(raw) },
      { key: 'reason', parse: (raw) => isReturnLineReason(raw) },
      { key: 'sourceConnectionId' },
      { key: 'createdFrom' },
      { key: 'createdTo' },
      { key: 'openedFrom' },
      { key: 'openedTo' },
    ],
    // The API sorts newest first and offers no other order, so the engine offers none and keeps `sort` out of the address.
    sorts: [],
    defaultSort: { key: 'opened', dir: 'desc' },
    systemViews: returnsSystemViews(input.viewNames),
    pinned: [ALL_RETURNS_VIEW_ID, 'needs_receiving', 'needs_disposition', 'restock_blocked', 'orphans'],
    lockedViewIds: [ALL_RETURNS_VIEW_ID, 'needs_receiving'],
  };
}
