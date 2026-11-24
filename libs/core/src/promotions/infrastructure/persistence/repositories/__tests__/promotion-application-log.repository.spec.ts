import type { Repository } from 'typeorm';

import type { PromotionApplicationOrmEntity } from '../../entities/promotion-application.orm-entity';
import { PromotionApplicationLogRepository } from '../promotion-application-log.repository';

describe('PromotionApplicationLogRepository.findOrderIdsNeedingAttention', () => {
  const makeRepository = (rows: { internalOrderId: string }[]) => {
    const query = jest.fn().mockResolvedValue(rows);
    const orm = { query } as unknown as Repository<PromotionApplicationOrmEntity>;
    return { repository: new PromotionApplicationLogRepository(orm), query };
  };

  it('should return the distinct order ids the query answers with', async () => {
    const { repository } = makeRepository([{ internalOrderId: 'o1' }, { internalOrderId: 'o2' }]);

    await expect(repository.findOrderIdsNeedingAttention(10)).resolves.toEqual(['o1', 'o2']);
  });

  it('should bind the limit and read only the latest, undismissed, non-applied rows', async () => {
    const { repository, query } = makeRepository([]);

    await repository.findOrderIdsNeedingAttention(25);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([25]);
    expect(sql).toContain('DISTINCT ON ("internalOrderId", "promotionId")');
    expect(sql).toContain(`outcome <> 'applied'`);
    expect(sql).toContain('"dismissedAt" IS NULL');
    expect(sql).toContain("'superseded-by-earlier-rule'");
  });
});
