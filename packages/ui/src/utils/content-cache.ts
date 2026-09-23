/**
 * IndexedDB-backed cache for loaded XML file contents. localStorage is too
 * small (~5 MB) to reliably store several D365 F&O ER Format XMLs, so the
 * full payloads are kept in IDB and only metadata references are persisted
 * elsewhere. All APIs are safe to call in non-browser environments (they
 * resolve to no-ops / null).
 */

const DB_NAME = 'er-visualizer';
const STORE_NAME = 'file-content';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIDB(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> | null {
  if (!hasIDB()) return null;
  if (dbPromise) return dbPromise;
  const opened: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // The browser can close the connection under us (storage cleared,
      // another tab upgrading the schema). Forget the cached handle so the
      // next call reopens instead of failing forever.
      const forget = () => {
        if (dbPromise === opened) dbPromise = null;
      };
      db.onclose = forget;
      db.onversionchange = () => {
        forget();
        db.close();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  }).catch(err => {
    if (dbPromise === opened) dbPromise = null;
    throw err;
  });
  dbPromise = opened;
  return opened;
}

/**
 * Start a transaction, dropping the cached connection when it can no longer
 * run one (`InvalidStateError` once the connection is closing) so a later
 * call gets a fresh one.
 */
function openTransaction(db: IDBDatabase, mode: IDBTransactionMode): IDBTransaction {
  try {
    return db.transaction(STORE_NAME, mode);
  } catch (err) {
    dbPromise = null;
    throw err;
  }
}

/**
 * Store a file's XML. Resolves to `true` only when the write committed, so
 * callers can tell a reopenable file from one the cache silently refused
 * (quota exceeded, private mode, no IndexedDB at all).
 */
export async function saveFileContent(path: string, content: string): Promise<boolean> {
  const p = openDb();
  if (!p) return false;
  try {
    const db = await p;
    await new Promise<void>((resolve, reject) => {
      const tx = openTransaction(db, 'readwrite');
      tx.objectStore(STORE_NAME).put(content, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    // Ignore — cache is best-effort.
    return false;
  }
}

export async function readFileContent(path: string): Promise<string | null> {
  const p = openDb();
  if (!p) return null;
  try {
    const db = await p;
    return await new Promise<string | null>((resolve, reject) => {
      const tx = openTransaction(db, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(path);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === 'string' ? v : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteFileContent(path: string): Promise<void> {
  const p = openDb();
  if (!p) return;
  try {
    const db = await p;
    await new Promise<void>((resolve, reject) => {
      const tx = openTransaction(db, 'readwrite');
      tx.objectStore(STORE_NAME).delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore.
  }
}

export async function clearAllFileContent(): Promise<void> {
  const p = openDb();
  if (!p) return;
  try {
    const db = await p;
    await new Promise<void>((resolve, reject) => {
      const tx = openTransaction(db, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore.
  }
}

export async function listCachedPaths(): Promise<string[]> {
  const p = openDb();
  if (!p) return [];
  try {
    const db = await p;
    return await new Promise<string[]>((resolve, reject) => {
      const tx = openTransaction(db, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => {
        const keys = req.result ?? [];
        resolve(keys.map(k => String(k)));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
