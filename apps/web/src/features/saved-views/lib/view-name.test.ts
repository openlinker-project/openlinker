import { describe, expect, it } from 'vitest';
import { isNameTaken, uniqueCopyName } from './view-name';

describe('view names', () => {
  it('should treat names as equal ignoring case and surrounding spaces', () => {
    expect(isNameTaken('  late TO ship ', [{ id: 'a', name: 'Late to ship' }])).toBe(true);
  });

  it('should not clash with the view being renamed', () => {
    expect(isNameTaken('Late', [{ id: 'a', name: 'Late' }], 'a')).toBe(false);
  });

  it('should number copies', () => {
    const views = [{ name: 'Gift' }, { name: 'Gift (copy)' }];
    expect(uniqueCopyName('Gift', views, 'copy')).toBe('Gift (copy 2)');
    expect(uniqueCopyName('Gift (copy)', views, 'copy')).toBe('Gift (copy 2)');
  });
});
