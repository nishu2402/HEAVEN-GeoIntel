// Shared test helpers for jsdom component tests.
//
// The jsdom environment configured here provides window/CustomEvent but NOT a
// working localStorage, so component tests that touch persisted client state
// install this minimal in-memory Storage first.

// cmdk (and other UI libs) call browser APIs jsdom doesn't implement:
// ResizeObserver and Element.scrollIntoView. No-op stubs are enough for
// interaction tests.
export function installResizeObserver(): void {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

export function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const mem: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true, writable: true });
}
