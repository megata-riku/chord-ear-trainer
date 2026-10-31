'use strict';
importScripts('music-theory.js?v=26','reference-policy.js?v=26','practice-model.js?v=26','progression.js?v=26','guitar.js?v=26','transfer-analysis.js?v=26','related-pooling.js?v=26','confusion-evidence.js?v=26','prediction-model.js?v=26','adaptive-selection.js?v=26');
self.onmessage=event=>{try{self.postMessage({result:EarAdaptive.createPlan(event.data.config,event.data.records)});}catch(error){self.postMessage({error:'適応出題を準備できませんでした。設定を確認してもう一度試してください。'});}};
