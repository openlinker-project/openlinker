/**
 * Authority Question Vocabulary Specs (#2351)
 *
 * Pins the seven-member question space and the invariant that keeps it honest
 * against the six-member `AuthorityKindValues`: a seventh authority kind added
 * later must not silently leave a question unmapped.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 */
import { AuthorityKindValues } from './authority-kind.types';
import {
  AUTHORITY_QUESTION_DESCRIPTORS,
  AuthorityMatrixRowValues,
  AuthorityQuestionValues,
  isAuthorityQuestion,
} from './authority-question.types';

describe('authority-question.types', () => {
  describe('AuthorityQuestionValues', () => {
    it('should expose exactly the seven questions of spec §3.3, in table order', () => {
      expect([...AuthorityQuestionValues]).toEqual([
        'availability',
        'sourcing',
        'fulfillment-execution',
        'order-lifecycle',
        'returns-disposition',
        'refund-trigger',
        'sales-documents',
      ]);
    });

    it('should carry one more member than AuthorityKindValues', () => {
      expect(AuthorityQuestionValues).toHaveLength(AuthorityKindValues.length + 1);
    });
  });

  describe('AUTHORITY_QUESTION_DESCRIPTORS', () => {
    it('should carry one entry per question, in the same order', () => {
      expect(Object.keys(AUTHORITY_QUESTION_DESCRIPTORS)).toEqual([...AuthorityQuestionValues]);
    });

    it('should map its non-null kinds to exactly AuthorityKindValues, in order', () => {
      const kinds = AuthorityQuestionValues.map(
        (question) => AUTHORITY_QUESTION_DESCRIPTORS[question].kind
      ).filter((kind): kind is (typeof AuthorityKindValues)[number] => kind !== null);

      expect(kinds).toEqual([...AuthorityKindValues]);
    });

    it("should give 'sales-documents' the only null kind — it is owned by another context", () => {
      const unmapped = AuthorityQuestionValues.filter(
        (question) => AUTHORITY_QUESTION_DESCRIPTORS[question].kind === null
      );

      expect(unmapped).toEqual(['sales-documents']);
    });

    it('should assign each question its ADR-052 matrix row, in order', () => {
      const rows = AuthorityQuestionValues.map(
        (question) => AUTHORITY_QUESTION_DESCRIPTORS[question].matrixRow
      );

      expect(rows).toEqual([...AuthorityMatrixRowValues]);
    });
  });

  describe('isAuthorityQuestion', () => {
    it('should accept every declared question', () => {
      for (const question of AuthorityQuestionValues) {
        expect(isAuthorityQuestion(question)).toBe(true);
      }
    });

    it('should reject a non-question value', () => {
      for (const value of ['', 'Availability', 'invoicing', null, undefined, 7, {}]) {
        expect(isAuthorityQuestion(value)).toBe(false);
      }
    });
  });
});
