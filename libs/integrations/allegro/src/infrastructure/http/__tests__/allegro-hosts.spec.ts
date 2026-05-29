/**
 * Unit spec for the Allegro host resolver (#892).
 *
 * Pins the four host strings explicitly so any future typo in a host value fails
 * here rather than silently shipping to one environment, and asserts the
 * unknown-environment defaults stay aligned between the two resolvers.
 */
import { getAllegroWebBaseUrl, getAllegroRestApiBaseUrl } from '../allegro-hosts';

describe('allegro-hosts', () => {
  describe('getAllegroWebBaseUrl', () => {
    it('should resolve the production web host when environment is production', () => {
      expect(getAllegroWebBaseUrl('production')).toBe('https://allegro.pl');
    });

    it('should resolve the sandbox web host when environment is sandbox', () => {
      expect(getAllegroWebBaseUrl('sandbox')).toBe('https://allegro.pl.allegrosandbox.pl');
    });

    it('should default to the sandbox web host when environment is unknown', () => {
      expect(getAllegroWebBaseUrl('staging')).toBe('https://allegro.pl.allegrosandbox.pl');
    });
  });

  describe('getAllegroRestApiBaseUrl', () => {
    it('should resolve the production REST host when environment is production', () => {
      expect(getAllegroRestApiBaseUrl('production')).toBe('https://api.allegro.pl');
    });

    it('should resolve the sandbox REST host when environment is sandbox', () => {
      expect(getAllegroRestApiBaseUrl('sandbox')).toBe('https://api.allegro.pl.allegrosandbox.pl');
    });

    it('should default to the sandbox REST host when environment is unknown', () => {
      expect(getAllegroRestApiBaseUrl('staging')).toBe('https://api.allegro.pl.allegrosandbox.pl');
    });
  });

  it('should keep web and REST resolvers on the same environment for the unknown-env default', () => {
    // Both default to sandbox: a connection must never authorize on one Allegro
    // environment while resolving REST calls against another.
    expect(getAllegroWebBaseUrl('???')).toContain('allegrosandbox.pl');
    expect(getAllegroRestApiBaseUrl('???')).toContain('allegrosandbox.pl');
  });
});
