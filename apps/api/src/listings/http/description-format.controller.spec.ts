/**
 * Description Format Controller - unit tests
 *
 * Two things are worth pinning: the DTO normalises the shapes the frontend reads
 * with plain property access (an absent `allowedAttributes` and an empty one must
 * not be two different things over the wire), and the endpoint never fails for an
 * unresolvable connection - an editor has nothing to do with that error.
 *
 * @module apps/api/src/listings/http
 */
import { DescriptionFormatController } from './description-format.controller';
import type { DescriptionFormatView, IDescriptionFormatReadService } from '@openlinker/core/listings';

describe('DescriptionFormatController', () => {
  let readService: jest.Mocked<IDescriptionFormatReadService>;
  let controller: DescriptionFormatController;

  beforeEach(() => {
    readService = { getForConnection: jest.fn() };
    controller = new DescriptionFormatController(readService);
  });

  function view(overrides: Partial<DescriptionFormatView['format']> = {}, rest: Partial<DescriptionFormatView> = {}): DescriptionFormatView {
    return {
      format: {
        shape: 'html',
        allowedTags: ['h1', 'p', 'b'],
        allowedAttributes: {},
        contentModel: { root: ['h1', 'p'], p: ['b'], h1: [] },
        rewrites: [{ from: 'strong', action: 'rename', to: 'b' }],
        requiresBlockOpener: true,
        maxBytes: 40000,
        ...overrides,
      },
      declared: true,
      resolvedVia: 'OfferManager',
      ...rest,
    };
  }

  it('should project a declared format field for field', async () => {
    readService.getForConnection.mockResolvedValue(view());

    const dto = await controller.getDescriptionFormat('conn-1');

    expect(dto).toEqual({
      shape: 'html',
      allowedTags: ['h1', 'p', 'b'],
      allowedAttributes: {},
      contentModel: { root: ['h1', 'p'], p: ['b'], h1: [] },
      rewrites: [{ from: 'strong', action: 'rename', to: 'b' }],
      requiresBlockOpener: true,
      selfClosingVoids: false,
      maxBytes: 40000,
      declared: true,
      resolvedVia: 'OfferManager',
    });
  });

  it('should normalise an absent allowedAttributes to an empty object', async () => {
    // The frontend reads these with plain property access; `undefined`, `{}` and
    // a missing key must not be three shapes for the same fact.
    readService.getForConnection.mockResolvedValue(view({ allowedAttributes: undefined }));

    const dto = await controller.getDescriptionFormat('conn-1');
    expect(dto.allowedAttributes).toEqual({});
  });

  it('should normalise absent optional booleans to false', async () => {
    readService.getForConnection.mockResolvedValue(
      view({ requiresBlockOpener: undefined, selfClosingVoids: undefined }),
    );

    const dto = await controller.getDescriptionFormat('conn-1');
    expect(dto.requiresBlockOpener).toBe(false);
    expect(dto.selfClosingVoids).toBe(false);
  });

  it('should normalise an absent maxBytes to null rather than omitting it', async () => {
    readService.getForConnection.mockResolvedValue(view({ maxBytes: undefined }));

    const dto = await controller.getDescriptionFormat('conn-1');
    expect(dto.maxBytes).toBeNull();
  });

  it('should keep a null contentModel null, since that means "flat allowlist"', async () => {
    readService.getForConnection.mockResolvedValue(view({ contentModel: null }));

    const dto = await controller.getDescriptionFormat('conn-1');
    expect(dto.contentModel).toBeNull();
  });

  it('should omit `to` on a rewrite that is not a rename', async () => {
    readService.getForConnection.mockResolvedValue(
      view({ rewrites: [{ from: 'br', action: 'split-block' }] }),
    );

    const dto = await controller.getDescriptionFormat('conn-1');
    expect(dto.rewrites).toEqual([{ from: 'br', action: 'split-block' }]);
  });

  it('should surface declared: false so the UI can say the format is a fallback', async () => {
    readService.getForConnection.mockResolvedValue(
      view({}, { declared: false, resolvedVia: null }),
    );

    const dto = await controller.getDescriptionFormat('conn-1');
    expect(dto.declared).toBe(false);
    expect(dto.resolvedVia).toBeNull();
  });

  it('should not copy array references from the domain value', async () => {
    const source = view();
    readService.getForConnection.mockResolvedValue(source);

    const dto = await controller.getDescriptionFormat('conn-1');
    expect(dto.allowedTags).not.toBe(source.format.allowedTags);
  });
});
