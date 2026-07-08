/**
 * Allegro Category Parameter Mapper — unit tests
 *
 * Drives the mapper against a real sandbox capture (cat 257933, "Aparaty
 * cyfrowe"). The fixture covers both dependency mechanisms in a single file:
 *   - parameter `229205` ("Stan opakowania") has `options.dependsOnParameterId`
 *     pointing to parameter `11323` ("Stan"), and each of its dictionary
 *     entries carries `dependsOnValueIds` arrays.
 *   - all other parameters have no parameter-level dependency and empty
 *     `dependsOnValueIds` on their entries.
 *
 * Parity note (#1382 review): `libs/integrations/erli/src/infrastructure/http
 * /__tests__/allegro-category-catalog-client.spec.ts` runs this same fixture
 * through `AllegroCategoryCatalogClient`'s independently-maintained copy of
 * `toNeutralCategoryParameter` with mirrored assertions — a change to this
 * mapper's behavior should prompt updating both spec files.
 *
 * @module libs/integrations/allegro/src/infrastructure/mappers
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type {
  AllegroCategoryParameter,
  AllegroCategoryParametersResponse,
} from '../../../domain/types/allegro-api.types';
import { toNeutralCategoryParameter } from '../allegro-category-parameter.mapper';

const FIXTURE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'adapters',
  '__fixtures__',
  'category-parameters-257933.json',
);

function loadFixture(): AllegroCategoryParametersResponse {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as AllegroCategoryParametersResponse;
}

function findRaw(
  fixture: AllegroCategoryParametersResponse,
  id: string,
): AllegroCategoryParameter {
  const found = fixture.parameters.find((p) => p.id === id);
  if (!found) throw new Error(`Fixture missing parameter ${id}`);
  return found;
}

describe('toNeutralCategoryParameter', () => {
  let fixture: AllegroCategoryParametersResponse;
  beforeAll(() => {
    fixture = loadFixture();
  });

  describe('basic field round-trip', () => {
    it('preserves id, name, type, required, unit', () => {
      const raw = findRaw(fixture, '38'); // "Rozdzielczość", float, Mpx
      const neutral = toNeutralCategoryParameter(raw);
      expect(neutral.id).toBe('38');
      expect(neutral.name).toBe('Rozdzielczość');
      expect(neutral.type).toBe('float');
      expect(neutral.required).toBe(true);
      expect(neutral.unit).toBe('Mpx');
    });

    it('passes through numeric restrictions (min/max/range/precision)', () => {
      const raw = findRaw(fixture, '38');
      const { restrictions } = toNeutralCategoryParameter(raw);
      expect(restrictions.min).toBe(0);
      expect(restrictions.max).toBe(1000);
      expect(restrictions.range).toBe(false);
      expect(restrictions.precision).toBe(2);
    });

    it('passes through string-length restrictions and numeric allowedNumberOfValues', () => {
      const raw = findRaw(fixture, '237206'); // "Model", string, 1..50, 1 value
      const { restrictions } = toNeutralCategoryParameter(raw);
      expect(restrictions.minLength).toBe(1);
      expect(restrictions.maxLength).toBe(50);
      expect(restrictions.allowedNumberOfValues).toBe(1);
    });

    it('passes through multipleChoices for multi-select dictionaries', () => {
      const raw = findRaw(fixture, '14349'); // "Stabilizacja", dictionary, multipleChoices
      const { restrictions, type } = toNeutralCategoryParameter(raw);
      expect(type).toBe('dictionary');
      expect(restrictions.multipleChoices).toBe(true);
    });

    it('hoists customValuesEnabled from options into restrictions', () => {
      const raw = findRaw(fixture, '201417'); // "Mocowanie", customValuesEnabled
      const { restrictions } = toNeutralCategoryParameter(raw);
      expect(restrictions.customValuesEnabled).toBe(true);
    });

    it('produces a dictionary array for dictionary-typed parameters', () => {
      const raw = findRaw(fixture, '11323'); // "Stan"
      const neutral = toNeutralCategoryParameter(raw);
      expect(Array.isArray(neutral.dictionary)).toBe(true);
      expect(neutral.dictionary?.length).toBeGreaterThan(0);
      expect(neutral.dictionary?.[0]).toMatchObject({ id: expect.any(String), value: expect.any(String) });
    });

    it('returns no dictionary on non-dictionary parameters', () => {
      const raw = findRaw(fixture, '38'); // float, no dictionary
      const neutral = toNeutralCategoryParameter(raw);
      expect(neutral.dictionary).toBeUndefined();
    });
  });

  describe('multi-value cardinality (#1035)', () => {
    it('sets multiValue=true for a multipleChoices dictionary parameter', () => {
      const neutral = toNeutralCategoryParameter(findRaw(fixture, '14349')); // "Stabilizacja", multipleChoices
      expect(neutral.multiValue).toBe(true);
    });

    it('sets multiValue=true when allowedNumberOfValues > 1', () => {
      const neutral = toNeutralCategoryParameter(findRaw(fixture, '218145')); // "Model załączonego obiektywu", anv=5
      expect(neutral.multiValue).toBe(true);
    });

    it('sets multiValue=false for single-value parameters', () => {
      expect(toNeutralCategoryParameter(findRaw(fixture, '237206')).multiValue).toBe(false); // "Model", string, anv=1
      expect(toNeutralCategoryParameter(findRaw(fixture, '38')).multiValue).toBe(false); // float, no value restriction
      expect(toNeutralCategoryParameter(findRaw(fixture, '11323')).multiValue).toBe(false); // "Stan", single-select dictionary
    });
  });

  describe('parameter-level visibility (dependsOn)', () => {
    it('returns undefined when there is no parameter-level dependency', () => {
      const raw = findRaw(fixture, '11323'); // "Stan", no dependsOnParameterId
      const neutral = toNeutralCategoryParameter(raw);
      expect(neutral.dependsOn).toBeUndefined();
    });

    it('builds dependsOn from options.dependsOnParameterId + entry-level value union', () => {
      const raw = findRaw(fixture, '229205'); // "Stan opakowania"
      const neutral = toNeutralCategoryParameter(raw);

      expect(neutral.dependsOn).toBeDefined();
      expect(neutral.dependsOn?.parameterId).toBe('11323');

      // Each of the 5 entries on parameter 229205 carries the same 21-value
      // dependsOnValueIds list in the captured fixture; the mapper unions
      // them into the visibility set.
      const expected = raw.dictionary![0].dependsOnValueIds!;
      expect(new Set(neutral.dependsOn?.valueIds ?? [])).toEqual(new Set(expected));
    });
  });

  describe('dictionary-entry filtering (dependsOnValueIds on entries)', () => {
    it('preserves non-empty dependsOnValueIds verbatim on each entry', () => {
      const raw = findRaw(fixture, '229205');
      const neutral = toNeutralCategoryParameter(raw);

      // Pick the first entry — should carry the same parent value IDs as in
      // the raw fixture.
      const rawEntry = raw.dictionary![0];
      const neutralEntry = neutral.dictionary![0];
      expect(neutralEntry.id).toBe(rawEntry.id);
      expect(neutralEntry.value).toBe(rawEntry.value);
      expect(neutralEntry.dependsOnValueIds).toEqual(rawEntry.dependsOnValueIds);
    });

    it('drops dependsOnValueIds when the array is empty (avoids meaningless field on every entry)', () => {
      const raw = findRaw(fixture, '11323'); // entries all carry empty arrays
      const neutral = toNeutralCategoryParameter(raw);

      for (const entry of neutral.dictionary ?? []) {
        expect(entry.dependsOnValueIds).toBeUndefined();
      }
    });
  });

  describe('boundary correctness', () => {
    it('does not surface formerData / requiredIf / displayedIf to CORE', () => {
      const raw = findRaw(fixture, '11323');
      const neutral = toNeutralCategoryParameter(raw) as unknown as Record<string, unknown>;
      expect(neutral.formerData).toBeUndefined();
      expect(neutral.requiredIf).toBeUndefined();
      expect(neutral.displayedIf).toBeUndefined();
    });

    it('produces the expected number of mapped entries on the large `Marka` dictionary', () => {
      const raw = findRaw(fixture, '248811'); // "Marka", ~2000 entries
      const neutral = toNeutralCategoryParameter(raw);
      expect(neutral.dictionary?.length).toBe(raw.dictionary?.length);
    });
  });

  describe('section flag (#415)', () => {
    it("emits section: 'product' for parameters with options.describesProduct === true", () => {
      // Marka (id 248811) is the canonical product-section parameter — it's
      // the one that triggered ParameterCategoryException in the bug report
      // when sent under body.parameters[]. Fixture confirms describesProduct=true.
      const raw = findRaw(fixture, '248811');
      expect(raw.options?.describesProduct).toBe(true);
      const neutral = toNeutralCategoryParameter(raw);
      expect(neutral.section).toBe('product');
    });

    it("emits section: 'offer' for parameters where describesProduct is false or absent", () => {
      // Stan (id 11323) is the classic offer-section parameter — every
      // operator-set condition lives here.
      const raw = findRaw(fixture, '11323');
      expect(raw.options?.describesProduct).not.toBe(true);
      const neutral = toNeutralCategoryParameter(raw);
      expect(neutral.section).toBe('offer');
    });
  });
});
