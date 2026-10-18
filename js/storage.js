// Persistenz: IndexedDB mit localStorage-Fallback.
// Stores: progress (Lernstand je Kartenschlüssel), packages (importierte Pakete),
//         days (Tagesstatistik je Datum), meta (Einstellungen, Schema u. a.),
//         reviews (Bewertungsprotokoll), cardmeta (Notizen, Aussetzen je Karte).

const DB_NAME = 'spanisch-trainer';
const DB_VERSION = 2; // v2: Stores reviews und cardmeta
export const STORES = ['progress', 'packages', 'days', 'meta', 'reviews', 'cardmeta'];

class IdbStorage {
  constructor(db) {
    this.db = db;
    this.kind = 'indexeddb';
  }

  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      try {
        result = fn(os);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaktion abgebrochen'));
    });
  }

  get(store, key) {
    return this._tx(store, 'readonly', (os) => os.get(key));
  }

  getAll(store) {
    return this._tx(store, 'readonly', (os) => os.getAll());
  }

  put(store, value) {
    return this._tx(store, 'readwrite', (os) => os.put(value)).then(() => undefined);
  }

  putMany(store, values) {
    return this._tx(store, 'readwrite', (os) => {
      for (const v of values) os.put(v);
    }).then(() => undefined);
  }

  delete(store, key) {
    return this._tx(store, 'readwrite', (os) => os.delete(key)).then(() => undefined);
  }

  clear(store) {
    return this._tx(store, 'readwrite', (os) => os.clear()).then(() => undefined);
  }
}

class LocalStorage {
  constructor() {
    this.kind = 'localstorage';
  }

  _key(store) {
    return `spanisch-trainer:${store}`;
  }

  _read(store) {
    try {
      const raw = localStorage.getItem(this._key(store));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _write(store, obj) {
    localStorage.setItem(this._key(store), JSON.stringify(obj));
  }

  async get(store, key) {
    return this._read(store)[key];
  }

  async getAll(store) {
    return Object.values(this._read(store));
  }

  async put(store, value) {
    const obj = this._read(store);
    obj[value.id] = value;
    this._write(store, obj);
  }

  async putMany(store, values) {
    const obj = this._read(store);
    for (const v of values) obj[v.id] = v;
    this._write(store, obj);
  }

  async delete(store, key) {
    const obj = this._read(store);
    delete obj[key];
    this._write(store, obj);
  }

  async clear(store) {
    localStorage.removeItem(this._key(store));
  }
}

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB nicht verfügbar'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB konnte nicht geöffnet werden'));
    req.onblocked = () => reject(new Error('IndexedDB blockiert'));
  });
}

/** Storage öffnen: IndexedDB, bei Fehler localStorage. */
export async function openStorage() {
  try {
    const db = await openIdb();
    return new IdbStorage(db);
  } catch (e) {
    console.warn('IndexedDB nicht nutzbar, verwende localStorage:', e && e.message);
    return new LocalStorage();
  }
}
