/**
 * Sales-Document Rule Repository Tests
 *
 * Covers the translation of a raw Postgres unique-constraint violation on
 * `UQ_sales_document_rules_country_hash_from` into the domain
 * `SalesDocumentRuleConflictException` - regression coverage for a bug found
 * during #2184's live e2e verification: the app-level `assertNoConflict`
 * guard deliberately lets a same-connection duplicate through (see its own
 * doc comment), but the unique index doesn't distinguish by connection at
 * all, so that exact case reached the DB and surfaced as an uncaught 500
 * instead of the intended 409.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { In, QueryFailedError } from 'typeorm';
import { SalesDocumentRuleRepository } from './sales-document-rule.repository';
import { SalesDocumentRuleConflictException } from '../../../domain/exceptions/sales-document-rule-conflict.exception';
import { SalesDocumentRule } from '../../../domain/entities/sales-document-rule.entity';

function makeUniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('INSERT ...', [], new Error('duplicate key value violates unique constraint "UQ_sales_document_rules_country_hash_from"'));
  (error as QueryFailedError & { code?: string }).code = '23505';
  return error;
}

describe('SalesDocumentRuleRepository', () => {
  describe('create', () => {
    it('should throw SalesDocumentRuleConflictException when the country/hash/effectiveFrom unique index rejects an exact same-connection duplicate', async () => {
      const existingRule = new SalesDocumentRule(
        'rule_existing',
        'FR',
        [],
        'hash123',
        'invoice',
        'conn_1',
        new Date('2026-01-01T00:00:00.000Z'),
        null,
        null,
        new Date(),
        new Date(),
      );

      const ormRepository = {
        create: jest.fn((v: unknown) => v),
        save: jest.fn().mockRejectedValue(makeUniqueViolation()),
        find: jest.fn().mockResolvedValue([
          {
            id: existingRule.id,
            country: existingRule.country,
            conditions: [],
            conditionsHash: existingRule.conditionsHash,
            documentKind: existingRule.documentKind,
            connectionId: existingRule.connectionId,
            effectiveFrom: existingRule.effectiveFrom,
            effectiveTo: existingRule.effectiveTo,
            provenance: existingRule.provenance,
            createdAt: existingRule.createdAt,
            updatedAt: existingRule.updatedAt,
          },
        ]),
      };

      const repository = new SalesDocumentRuleRepository(ormRepository as never);

      await expect(
        repository.create({
          country: 'FR',
          conditions: [],
          conditionsHash: 'hash123',
          documentKind: 'invoice',
          connectionId: 'conn_1',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
          provenance: null,
        }),
      ).rejects.toThrow(SalesDocumentRuleConflictException);
    });

    it('should rethrow an unrelated database error unchanged', async () => {
      const ormRepository = {
        create: jest.fn((v: unknown) => v),
        save: jest.fn().mockRejectedValue(new Error('connection terminated unexpectedly')),
        find: jest.fn(),
      };
      const repository = new SalesDocumentRuleRepository(ormRepository as never);

      await expect(
        repository.create({
          country: 'FR',
          conditions: [],
          conditionsHash: 'hash123',
          documentKind: 'invoice',
          connectionId: 'conn_1',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
          provenance: null,
        }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('findByCountries (#2516)', () => {
    it('reads nothing for an empty input', async () => {
      const ormRepository = { find: jest.fn() };
      const repository = new SalesDocumentRuleRepository(
        ormRepository as unknown as ConstructorParameters<typeof SalesDocumentRuleRepository>[0],
      );

      await expect(repository.findByCountries([])).resolves.toEqual([]);
      expect(ormRepository.find).not.toHaveBeenCalled();
    });

    it('issues ONE query for every country in the batch', async () => {
      const ormRepository = { find: jest.fn().mockResolvedValue([]) };
      const repository = new SalesDocumentRuleRepository(
        ormRepository as unknown as ConstructorParameters<typeof SalesDocumentRuleRepository>[0],
      );

      await repository.findByCountries(['PL', 'DE', '*']);

      expect(ormRepository.find).toHaveBeenCalledTimes(1);
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { country: In(['PL', 'DE', '*']) },
      });
    });
  });
});
