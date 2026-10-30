const DB_NAME = "donorgram-media";
const STORE = "blobs";
const DB_VERSION = 1;

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть локальный кэш"));
  });
}

/** Сохраняет уже загруженное медиа локально, чтобы не скачивать его повторно. */
export async function cacheMedia(path: string, blob: Blob): Promise<void> {
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ blob, savedAt: Date.now() }, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Не удалось сохранить медиа"));
    tx.onabort = () => reject(tx.error || new Error("Сохранение медиа отменено"));
  });
  db.close();
}

/** Возвращает локальную копию или null; сеть вызывающий код использует только при промахе. */
export async function readCachedMedia(path: string): Promise<Blob | null> {
  const db = await openCache();
  const value = await new Promise<{ blob?: Blob } | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(path);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось прочитать кэш"));
  });
  db.close();
  return value?.blob instanceof Blob ? value.blob : null;
}

/** Ограничивает кэш примерно 100 МБ: сначала удаляются самые старые элементы. */
export async function pruneMediaCache(maxBytes = 100 * 1024 * 1024): Promise<void> {
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const entries: { key: IDBValidKey; size: number; savedAt: number }[] = [];
    let total = 0;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (item) {
        const blob = item.value?.blob as Blob | undefined;
        const size = blob?.size || 0;
        total += size;
        entries.push({ key: item.key, size, savedAt: item.value?.savedAt || 0 });
        item.continue();
      } else {
        entries.sort((a, b) => a.savedAt - b.savedAt);
        for (const entry of entries) {
          if (total <= maxBytes) break;
          store.delete(entry.key);
          total -= entry.size;
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Не удалось очистить кэш"));
  });
  db.close();
}
