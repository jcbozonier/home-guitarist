const requestResult = request => new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
let database;
async function db() {
  if (!database) database = new Promise((resolve,reject) => {
    const request = indexedDB.open('songcraft',1);
    request.onupgradeneeded = () => request.result.createObjectStore('sketches',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
  return database;
}
export async function listSketches() { return requestResult((await db()).transaction('sketches').objectStore('sketches').getAll()); }
export async function writeSketch(sketch) {
  const tx = (await db()).transaction('sketches','readwrite');
  tx.objectStore('sketches').put(sketch);
  return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export async function deleteSketch(id) {
  const tx = (await db()).transaction('sketches','readwrite'); tx.objectStore('sketches').delete(id);
  return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
