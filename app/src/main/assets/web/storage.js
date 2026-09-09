(function (root) {
  'use strict';

  const DB_NAME = 'renji-notebook-db';
  const DB_VERSION = 1;
  const STORE_NAME = 'app-state';
  const STATE_KEY = 'current';
  const FALLBACK_KEY = 'renji-notebook-state-v1';
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
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
    try {
      return await readIndexedDb();
    } catch (error) {
      try {
        const raw = root.localStorage && root.localStorage.getItem(FALLBACK_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (fallbackError) {
        return null;
      }
    }
  }

  async function saveState(value) {
    const snapshot = JSON.parse(JSON.stringify(value));
    try {
      await writeIndexedDb(snapshot);
      return 'indexeddb';
    } catch (error) {
      if (!root.localStorage) throw error;
      root.localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
      return 'localstorage';
    }
  }

  async function clearState() {
    try {
      await clearIndexedDb();
    } catch (error) {
      // Fallback storage is still cleared below.
    }
    if (root.localStorage) root.localStorage.removeItem(FALLBACK_KEY);
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
