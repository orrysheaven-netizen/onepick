type AuthStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

// Some in-app browsers and Safari with all site data blocked throw on the first localStorage
// access. That happened at module load, before any error boundary, and left a blank page.
// Fall back to an in-memory store: sign-in works for this tab, it just does not persist.
function memoryStorage(): AuthStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function browserStorage(): AuthStorage | undefined {
  // Static web rendering has no browser storage.
  if (typeof window === 'undefined') return undefined;
  try {
    const storage = window.localStorage;
    const probe = '__onepick_storage_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
}

export const authStorage = browserStorage();
