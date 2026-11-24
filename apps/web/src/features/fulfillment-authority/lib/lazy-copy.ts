/**
 * Lazy copy
 *
 * Wraps a copy read (`() => getMessages(ns).x`) in an object that answers every
 * property access, key listing and `in` test from the copy of the language
 * active at that moment (#3875, ADR-081).
 *
 * It exists so this feature's exported constants (`ATTENTION_REASON_COPY`,
 * `WHO_DECIDES_PAGE_COPY` ...) keep their names and shapes for the orders,
 * products and settings pages that import them, while the words live in
 * `locales/<lang>/<namespace>.json`. A module-level `getMessages` call would freeze the
 * first language; this defers every read to the moment it happens.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 */

export function lazyCopy<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get: (_target, key) => Reflect.get(read(), key) as unknown,
    has: (_target, key) => Reflect.has(read(), key),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), key);
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },
  });
}
