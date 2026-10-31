'use strict';
function earUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
class EarHistoryStore {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ear-lab-history', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('attempts', { keyPath: 'id' });
        request.result.createObjectStore('meta', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('別のタブが履歴を使用しています。'));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async list() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('attempts', 'readonly');
      const request = transaction.objectStore('attempts').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async userId() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('meta', 'readwrite');
      const store = transaction.objectStore('meta');
      let id;
      const request = store.get('user');
      request.onsuccess = () => {
        id = request.result?.value || earUUID();
        if (!request.result) store.add({id:'user', value:id});
      };
      transaction.oncomplete = () => resolve(id);
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async sessions() {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('meta','readonly'),request=tx.objectStore('meta').getAll();
      tx.oncomplete=()=>resolve(request.result.filter(r=>r.id.startsWith('session:')).map(r=>r.value));
      tx.onerror=()=>reject(tx.error);
    });
  }
  async saveSession(value) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('meta','readwrite');
      tx.objectStore('meta').put({id:'session:'+value.id,value});
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async predictionReport() {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('meta','readonly'),request=tx.objectStore('meta').get('prediction:lastReport');
      tx.oncomplete=()=>resolve(request.result?.value);tx.onerror=()=>reject(tx.error);
    });
  }
  async savePredictionReport(value) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('meta','readwrite');tx.objectStore('meta').put({id:'prediction:lastReport',value});
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async preference() {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('meta','readonly');
      const request=tx.objectStore('meta').get('practiceBehavior');
      tx.oncomplete=()=>resolve(request.result?.value);
      tx.onerror=()=>reject(tx.error);
    });
  }
  async savePreference(value) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('meta','readwrite');
      tx.objectStore('meta').put({id:'practiceBehavior',value});
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });
  }
  async referencePreference(){
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('meta','readonly'),request=tx.objectStore('meta').get('referenceAllowed');tx.oncomplete=()=>resolve(request.result?.value);tx.onerror=()=>reject(tx.error);});
  }
  async saveReferencePreference(value){
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('meta','readwrite');tx.objectStore('meta').put({id:'referenceAllowed',value});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
  async saveReferenceAfterCount(id,count){
    if(!ReferencePolicy.validCount(count))throw new Error('Invalid reference count');
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('attempts','readwrite'),store=tx.objectStore('attempts'),request=store.get(id);request.onsuccess=()=>{const record=request.result;if(record?.question.referenceAllowed){record.referenceAfterAnswerPlaybackCount=Math.max(record.referenceAfterAnswerPlaybackCount||0,count);store.put(record);}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }
  // Duplicate attempt IDs are preserved: a restored backup cannot replace an answer.
  async saveAdaptiveModel(id,value){return new Promise((resolve,reject)=>{const tx=this.db.transaction('meta','readwrite');tx.objectStore('meta').put({id:'adaptive:model:'+id,value});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  async adaptiveModels(){return new Promise((resolve,reject)=>{const tx=this.db.transaction('meta','readonly'),request=tx.objectStore('meta').getAll();request.onsuccess=()=>resolve(request.result.filter(r=>r.id.startsWith('adaptive:model:')));request.onerror=()=>reject(request.error);});}
  async add(records) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('attempts', 'readwrite');
      const store = transaction.objectStore('attempts');
      let added = 0;
      for (const record of records) {
        const request = store.get(record.id);
        request.onsuccess = () => { if (!request.result) { store.add(record); added++; } };
      }
      transaction.oncomplete = () => resolve(added);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('保存が中断されました。'));
    });
  }
}
