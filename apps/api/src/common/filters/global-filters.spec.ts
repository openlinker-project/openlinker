import { ApiErrorCodeFilter } from './api-error-code.filter';
import { buildGlobalExceptionFilters } from './global-filters';

describe('buildGlobalExceptionFilters', () => {
  it('should register the catch-all first, so Nest checks it after every domain filter', () => {
    // Nest reverses the global list and runs the first filter whose @Catch
    // matches; the catch-all matches everything, so anywhere but first it
    // would answer for the domain errors too.
    const filters = buildGlobalExceptionFilters();

    expect(filters[0]).toBeInstanceOf(ApiErrorCodeFilter);
    expect(filters.slice(1).some((f) => f instanceof ApiErrorCodeFilter)).toBe(false);
  });

  it('should return fresh instances on every call', () => {
    expect(buildGlobalExceptionFilters()[0]).not.toBe(buildGlobalExceptionFilters()[0]);
  });
});
