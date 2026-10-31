'use strict';
importScripts('music-theory.js?v=26','reference-policy.js?v=26','practice-model.js?v=26','progression.js?v=26','transfer-analysis.js?v=26','related-pooling.js?v=26','confusion-evidence.js?v=26','prediction-model.js?v=26');
self.onmessage=event=>{
  try{self.postMessage({result:EarPrediction.run(event.data.records,event.data.config)});}
  catch(error){self.postMessage({error:'予測実験を実行できませんでした。履歴を保存してから、再読み込みして試してください。'});}
};
