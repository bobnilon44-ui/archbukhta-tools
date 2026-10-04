/* Обёртка над IndexedDB: схема, транзакции, простые хелперы.
 * Обычный скрипт (не ES-модуль), чтобы работать и через http://localhost, и при открытии файла напрямую. */
(function (root) {
  'use strict';
  var AB = (root.AB = root.AB || {});

  var DB_NAME = 'archbukhta-tools';
  var DB_VERSION = 1;
  var ALL_STORES = ['teams', 'toolTypes', 'items', 'consumables', 'operations', 'settings'];

  var DEFAULT_SETTINGS = {
    adminPin: '0000',
    defaultLimit: 2,
    batteryLimit: 4,
    cartTimeoutSec: 60,
    soundOn: true,
    eventName: 'АрхБухта'
  };

  function upgrade(db) {
    if (!db.objectStoreNames.contains('teams')) {
      db.createObjectStore('teams', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('toolTypes')) {
      db.createObjectStore('toolTypes', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('items')) {
      var items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('status', 'status');
      items.createIndex('typeId', 'typeId');
      items.createIndex('holderTeamId', 'holderTeamId');
    }
    if (!db.objectStoreNames.contains('consumables')) {
      db.createObjectStore('consumables', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('operations')) {
      var ops = db.createObjectStore('operations', { keyPath: 'id', autoIncrement: true });
      ops.createIndex('ts', 'ts');
      ops.createIndex('teamId', 'teamId');
      ops.createIndex('itemId', 'itemId');
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  }

  var dbPromise = null;

  function open(name) {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var r = root.indexedDB.open(name || DB_NAME, DB_VERSION);
      r.onupgradeneeded = function () { upgrade(r.result); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.onblocked = function () { reject(new Error('База открыта в другой вкладке со старой версией. Закройте лишние вкладки.')); };
    });
    return dbPromise;
  }

  /** Сбросить кэш соединения (для тестов). */
  function _reset() {
    if (dbPromise) dbPromise.then(function (db) { db.close(); }).catch(function () {});
    dbPromise = null;
  }

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  /**
   * Выполнить fn(tx) в одной транзакции. Если fn бросает ошибку — транзакция откатывается целиком.
   * Внутри fn можно await-ить только запросы к этой же транзакции.
   */
  function run(stores, mode, fn) {
    return open().then(function (db) {
      var tx = db.transaction(stores, mode);
      var done = new Promise(function (resolve, reject) {
        tx.oncomplete = function () { resolve(); };
        tx.onabort = function () { reject(tx.error || new Error('Транзакция отменена')); };
      });
      done.catch(function () {});
      return Promise.resolve()
        .then(function () { return fn(tx); })
        .then(
          function (result) { return done.then(function () { return result; }); },
          function (err) {
            try { tx.abort(); } catch (e) { /* уже завершена */ }
            return done.then(function () { throw err; }, function () { throw err; });
          }
        );
    });
  }

  function get(tx, store, key) { return req(tx.objectStore(store).get(key)); }
  function put(tx, store, value) { return req(tx.objectStore(store).put(value)); }
  function add(tx, store, value) { return req(tx.objectStore(store).add(value)); }
  function del(tx, store, key) { return req(tx.objectStore(store).delete(key)); }
  function all(tx, store) { return req(tx.objectStore(store).getAll()); }
  function byIndex(tx, store, index, value) {
    return req(tx.objectStore(store).index(index).getAll(value));
  }

  function getAll(store) {
    return run([store], 'readonly', function (tx) { return all(tx, store); });
  }
  function getOne(store, key) {
    return run([store], 'readonly', function (tx) { return get(tx, store, key); });
  }

  async function readSettings(tx) {
    var rows = await all(tx, 'settings');
    var s = Object.assign({}, DEFAULT_SETTINGS);
    rows.forEach(function (r) { s[r.key] = r.value; });
    return s;
  }

  function getSettings() {
    return run(['settings'], 'readonly', readSettings);
  }

  function setSettings(patch) {
    return run(['settings'], 'readwrite', async function (tx) {
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) await put(tx, 'settings', { key: k, value: patch[k] });
      }
    });
  }

  AB.db = {
    DB_NAME: DB_NAME,
    ALL_STORES: ALL_STORES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    open: open,
    run: run,
    req: req,
    get: get,
    put: put,
    add: add,
    del: del,
    all: all,
    byIndex: byIndex,
    getAll: getAll,
    getOne: getOne,
    readSettings: readSettings,
    getSettings: getSettings,
    setSettings: setSettings,
    _reset: _reset
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AB.db;
})(typeof window !== 'undefined' ? window : globalThis);
