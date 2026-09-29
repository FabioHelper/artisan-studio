// IndexedDB storage. Plates, meals, photo blobs, the unfinished meal (draft) and settings stay on the phone.
const NAME = 'macrofy-capture';
const VERSION = 3; // 2: adds the estimates store (T-013); 3: adds the checks store (T-016, scale checks); onupgradeneeded creates any missing store
const STORES = { plates: 'id', meals: 'id', photos: 'sha256', kv: 'key', estimates: 'id', checks: 'id' };

let dbp;
export function openDb() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => { for (const [s, key] of Object.entries(STORES)) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: key }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export async function getAll(store) { return wrap((await openDb()).transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { return wrap((await openDb()).transaction(store).objectStore(store).get(key)); }
export async function put(store, value) { const tx = (await openDb()).transaction(store, 'readwrite'); tx.objectStore(store).put(value); return done(tx); }
export async function del(store, key) { const tx = (await openDb()).transaction(store, 'readwrite'); tx.objectStore(store).delete(key); return done(tx); }

export const getSetting = async (key) => (await get('kv', key))?.value;
export const setSetting = (key, value) => put('kv', { key, value });

/** Saves a meal and its photo blobs in one transaction. photos: [{sha256, blob}]. */
export async function saveMeal(meal, photos) {
  const tx = (await openDb()).transaction(['meals', 'photos'], 'readwrite');
  for (const p of photos) tx.objectStore('photos').put({ sha256: p.sha256, blob: p.blob, meal_id: meal.id });
  tx.objectStore('meals').put(meal);
  return done(tx);
}
export async function deleteMeal(meal) {
  const tx = (await openDb()).transaction(['meals', 'photos'], 'readwrite');
  for (const p of meal.photos) tx.objectStore('photos').delete(p.sha256);
  tx.objectStore('meals').delete(meal.id);
  return done(tx);
}
/** True when a photo with this sha256 is already saved in any meal. */
export async function hasPhoto(sha256) { return (await get('photos', sha256)) !== undefined; }
