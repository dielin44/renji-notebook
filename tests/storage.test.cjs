const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/storage.js'), 'utf8');

function createRuntime(options = {}) {
  const values = new Map();
  if (options.localState) values.set('renji-notebook-state-v1', JSON.stringify(options.localState));
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const context = vm.createContext({
    console,
    AndroidBridge: options.bridge,
    localStorage
  });
  vm.runInContext(source, context, { filename: 'storage.js' });
  return { Store: context.RenjiStore, values };
}

test('Android 原生檔案儲存優先於不可靠的 WebView 儲存', async () => {
  let nativeJson = '';
  const bridge = {
    loadState() { return nativeJson; },
    saveState(value) { nativeJson = value; return true; },
    clearState() { nativeJson = ''; return true; }
  };
  const { Store } = createRuntime({ bridge });
  const state = { people: [{ id: 'p1', name: '新人物' }], events: [], loans: [] };
  assert.equal(await Store.saveState(state), 'native-file');
  assert.deepEqual(JSON.parse(nativeJson), state);
  assert.deepEqual(JSON.parse(JSON.stringify(await Store.loadState())), state);
});

test('舊版 localStorage 資料會自動搬移至 Android 原生檔案', async () => {
  const legacy = { people: [{ id: 'old', name: '舊資料' }], events: [], loans: [] };
  let migratedJson = '';
  const bridge = {
    loadState() { return ''; },
    saveState(value) { migratedJson = value; return true; },
    clearState() { return true; }
  };
  const { Store } = createRuntime({ bridge, localState: legacy });
  assert.deepEqual(JSON.parse(JSON.stringify(await Store.loadState())), legacy);
  assert.deepEqual(JSON.parse(migratedJson), legacy);
});
