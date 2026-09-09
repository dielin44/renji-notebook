(function (root) {
  'use strict';

  const DB_NAME = 'renji-notebook-db';
  const DB_VERSION = 1;
  const STORE_NAME = 'app-state';
  const STATE_KEY = 'current';
  const FALLBACK_KEY = 'renji-notebook-state-v1';
  let databasePromise;

  function nativeStore() {
    try {
      const bridge = root.AndroidBridge;
      if (bridge && typeof bridge.loadState === 'function' && typeof bridge.saveState === 'function') {
        return bridge;
      }
    } catch (error) {
      // Continue with browser storage when the native bridge is unavailable.
    }
    return null;
  }

  function readNativeState() {
    const bridge = nativeStore();
    if (!bridge) return { available: false, value: null };
    try {
      const raw = String(bridge.loadState() || '');
      return { available: true, value: raw ? JSON.parse(raw) : null };
    } catch (error) {
      return { available: true, value: null };
    }
  }

  function writeNativeState(value) {
    const bridge = nativeStore();
    if (!bridge) return false;
    try {
      const result = bridge.saveState(JSON.stringify(value));
      return result === true || String(result).toLowerCase() === 'true';
    } catch (error) {
      return false;
    }
  }

  function readLocalState() {
    try {
      const storage = root.localStorage;
      const raw = storage ? storage.getItem(FALLBACK_KEY) : '';
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeLocalState(value) {
    try {
      const storage = root.localStorage;
      if (!storage) return false;
      storage.setItem(FALLBACK_KEY, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let indexedDb;
      try {
        indexedDb = root.indexedDB;
      } catch (error) {
        reject(error);
        return;
      }
      if (!indexedDb) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = indexedDb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Cannot open IndexedDB'));
    });
    return databasePromise;
  }

  async function readIndexedDb() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Cannot read state'));
    });
  }

  async function writeIndexedDb(value) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Cannot save state'));
      transaction.onabort = () => reject(transaction.error || new Error('Save aborted'));
    });
  }

  async function clearIndexedDb() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Cannot clear state'));
    });
  }

  async function loadState() {
    const native = readNativeState();
    if (native.value) return native.value;

    let legacy = null;
    try {
      legacy = await readIndexedDb();
      if (!legacy) legacy = readLocalState();
    } catch (error) {
      legacy = readLocalState();
    }
    if (legacy && native.available) {
      writeNativeState(legacy);
    }
    return legacy;
  }

  async function saveState(value) {
    const snapshot = JSON.parse(JSON.stringify(value));
    if (writeNativeState(snapshot)) return 'native-file';

    try {
      await writeIndexedDb(snapshot);
      return 'indexeddb';
    } catch (error) {
      if (writeLocalState(snapshot)) return 'localstorage';
      throw new Error('本機儲存空間無法寫入，請重新開啟 App 後再試');
    }
  }

  async function clearState() {
    const bridge = nativeStore();
    if (bridge && typeof bridge.clearState === 'function') {
      try {
        bridge.clearState();
      } catch (error) {
        // Legacy storage is still cleared below.
      }
    }
    try {
      await clearIndexedDb();
    } catch (error) {
      // Fallback storage is still cleared below.
    }
    try {
      const storage = root.localStorage;
      if (storage) storage.removeItem(FALLBACK_KEY);
    } catch (error) {
      // Nothing else to clear.
    }
  }

  async function requestPersistence() {
    try {
      if (root.navigator.storage && root.navigator.storage.persist) {
        return await root.navigator.storage.persist();
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  root.RenjiStore = { loadState, saveState, clearState, requestPersistence };
})(typeof globalThis !== 'undefined' ? globalThis : this);
