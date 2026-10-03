// IndexedDB: saved scans (history) and photos waiting for a connection.
const DB_NAME = "cdbin";
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("scans", { keyPath: "id" });
        db.createObjectStore("queue", { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

export const saveScan = (scan) => tx("scans", "readwrite", (s) => s.put(scan));
export const getScan = (id) => tx("scans", "readonly", (s) => s.get(id));
export const deleteScan = (id) => tx("scans", "readwrite", (s) => s.delete(id));
export const listScans = async () => ((await tx("scans", "readonly", (s) => s.getAll())) || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const enqueuePhoto = (entry) => tx("queue", "readwrite", (s) => s.put(entry));
export const listQueue = async () => (await tx("queue", "readonly", (s) => s.getAll())) || [];
export const dequeuePhoto = (id) => tx("queue", "readwrite", (s) => s.delete(id));
