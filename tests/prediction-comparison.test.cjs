const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({});for(const f of ['music-theory','reference-policy','practice-model','progression','curriculum','transfer-analysis','related-pooling','confusion-evidence','prediction-model'])vm.runInContext(fs.readFileSync('dist/'+f+'.js','utf8'),ctx);
const [E,P,C,T,M]=vm.runInContext('[EarPrediction,Progression,Curriculum,MusicTheory,PracticeModel]',ctx);
function rng(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function fixture(){
 const rows=[];
 for(let session=0;session<24;session++){
  const stage=4+session%4,key='C_major',plan=C.createPlan(stage,key,rng(session+21));
  for(let i=0;i<10;i++){
   const item=plan.items[i],time=Date.parse('2026-10-20T00:00:00Z')+session*3600000+i*20000;let start=0;
   const chords=item.solution.chords.map(c=>{const notes=Array.from(T.intervals[T.qualityIds.indexOf(c.quality)],n=>n+c.rootMidi),v={...c,notes,duration:.8,start};start+=.8+P.gap;return v;});
   const correct=chords.at(-1).quality==='minor',answer=correct?item.solution.key:null;
   rows.push({schemaVersion:1,id:'comparison-synthetic-'+session+'-'+i,userId:'comparison-synthetic',sessionId:'comparison-synthetic-'+session,answeredAt:new Date(time+10000).toISOString(),correct,answer,playbackCount:1,responseTimeMs:9000,
    question:{task:'chord_progression',key,rootMidi:chords[0].rootMidi,quality:chords[0].quality,notes:chords[0].notes,instrument:'piano',duration:.8,octave:0,createdAt:new Date(time).toISOString(),referenceBeforeQuestion:false,options:Array.from(item.options,o=>o.key),selectionPolicy:'uniform',progression:{version:P.version,length:chords.length,inputMode:[4,6].includes(stage)?'four':'ordered',gap:P.gap,chords,candidateMode:item.candidateMode,positionCorrect:Array.from(P.positions(chords,answer?P.decode(answer):null))}}});
  }
 }
 return rows;
}
const records=fixture(),config={userId:'comparison-synthetic',task:'chord_progression'},report=E.run(records,config);
assert.equal(M.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:records}).length,240);
assert.equal(report.status,'ready');assert.equal(report.summary.eligible,240);assert.equal(report.summary.excluded.unsupported,0);
assert.equal(report.formatGroups.length,4);assert.equal(report.candidateGroups.length,2);
for(const row of [...report.trainingRows,...report.evaluationRows]){assert.equal(row.x.length,E.features.length);assert.ok(row.x.every(Number.isFinite));}
for(const key of E.modelKeys){assert.ok(Number.isFinite(report.metrics[key].brier));assert.ok(report.evaluationRows.every(r=>r[key]>0&&r[key]<1));assert.equal(report.calibrations[key].reduce((sum,b)=>sum+b.count,0),report.summary.testCount);}
for(const key of ['logistic','tree','boosted'])assert.ok(report.metrics[key].logLoss<report.metrics.global.logLoss,'model learns later chord signal: '+key);
// The same first chord, notes and candidates do not collapse different later targets.
const a=records[0].question,b=structuredClone(a);b.progression.chords[1]=structuredClone(records[1].question.progression.chords[1]);if(P.keyOf(a.progression.chords)!==P.keyOf(b.progression.chords))assert.notEqual(E.conditionKey(a),E.conditionKey(b));
const testIds=new Set(report.evaluationRows.map(r=>r.id));
const changed=records.map(row=>{const r=structuredClone(row);if(testIds.has(r.id)){r.correct=!r.correct;r.answer=r.correct?P.keyOf(r.question.progression.chords):null;r.question.progression.positionCorrect=Array.from(P.positions(r.question.progression.chords,r.answer?P.decode(r.answer):null));}return r;});
const future=E.run(changed,config);
for(const key of ['logistic','tree','boosted']){assert.equal(JSON.stringify(report.models[key]),JSON.stringify(future.models[key]),'future labels cannot alter fitted '+key);assert.equal(report.evaluationRows[0][key],future.evaluationRows[0][key]);}
const scrambled=E.run([...records].reverse(),config);assert.equal(JSON.stringify(report.models),JSON.stringify(scrambled.models),'fitting is deterministic');
const behavior=E.run(records.map(r=>({...r,playbackCount:200,responseTimeMs:999999,referencePlaybackCount:200})),config);assert.equal(JSON.stringify(report.models),JSON.stringify(behavior.models),'current response/replay excluded');
const filtered=E.prepare(records,{...config,format:'progression_2_four'});assert.equal(filtered.summary.eligible,60);
const broken=structuredClone(records[0]);broken.question.progression.chords[1].start=0;assert.equal(E.prepare([broken],config).summary.excluded.invalid,1);
const roundtrip=JSON.parse(JSON.stringify(report));for(const row of roundtrip.evaluationRows){assert.equal(E.predict(roundtrip.models.logistic,row.x),row.logistic);assert.equal(E.predictTree(roundtrip.models.tree,row.x),row.tree);assert.equal(E.predictBoosted(roundtrip.models.boosted,row.x),row.boosted);}
// Exact Worker entry point: dependency imports, serialization and running all five methods.
let workerResult;const workerCtx=vm.createContext({self:{postMessage:result=>{workerResult=result;}}});workerCtx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync('dist/'+f.split('?')[0],'utf8'),workerCtx));vm.runInContext(fs.readFileSync('dist/prediction-worker.js','utf8'),workerCtx);workerCtx.self.onmessage({data:{records,config}});assert.equal(workerResult.result.status,'ready');assert.equal(workerResult.result.metrics.boosted.brier,report.metrics.boosted.brier);
if(process.env.COMPARISON_FIXTURE)fs.writeFileSync(process.env.COMPARISON_FIXTURE,JSON.stringify({format:'ear-lab-history',schemaVersion:1,attempts:records}));
console.log('PASS: progression targets, four formats, eight probability methods, later-position signal, frozen fits, causal behavior, deterministic replay, complete exported model reproduction and Worker entry point.');
// Legacy reports still render with three metrics and logistic calibration only.
class Element{constructor(){this.children=[];this.value='';this.textContent='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}get options(){return this.children;}}
const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}};
const uiCtx=vm.createContext({document,EarPrediction:E,MusicTheory:T,ReferencePolicy:vm.runInContext('ReferencePolicy',ctx)});vm.runInContext(fs.readFileSync('dist/prediction-ui.js','utf8'),uiCtx);const Panel=vm.runInContext('PredictionPanel',uiCtx),panel=new Panel({store:{},notice(){}});
document.getElementById('predictionUser').value=config.userId;document.getElementById('predictionTask').value=config.task;document.getElementById('predictionKey').value='all';panel.report=roundtrip;panel.paintReport();assert.equal(elements.get('predictionMetrics').children.length,14);assert.equal(elements.get('predictionCalibrationModel').children.length,14);elements.get('predictionCalibrationModel').value='boosted';panel.paintCalibration();assert.equal(elements.get('predictionCalibration').children.length,5);
const legacy=structuredClone(roundtrip);delete legacy.calibrations;delete legacy.models;delete legacy.modelLabels;delete legacy.formatGroups;delete legacy.candidateGroups;delete legacy.experimentVersion;legacy.model.version='correctness-logistic-v2';delete legacy.transferComparison;delete legacy.confusionComparison;for(const k of ['tree','boosted','base_tree','base_boosted','base_logistic','auto_logistic','auto_tree','auto_boosted','no_confusion_logistic','no_confusion_tree','no_confusion_boosted'])delete legacy.metrics[k];for(const group of [...legacy.groups,...legacy.keyGroups])for(const k of ['tree','boosted','base_tree','base_boosted','base_logistic','auto_logistic','auto_tree','auto_boosted','no_confusion_logistic','no_confusion_tree','no_confusion_boosted'])delete group.models[k];panel.report=legacy;panel.paintReport();assert.equal(elements.get('predictionMetrics').children.length,3);assert.equal(elements.get('predictionCalibrationModel').children.length,1);assert.equal(elements.get('predictionCalibrationModel').value,'logistic');assert.ok(elements.get('predictionReportNotice').textContent.includes('correctness-logistic-v2'));
console.log('PASS: eight-method report UI, calibration switching and saved v2 report compatibility.');

assert.equal(report.transferComparison.length,3);
for(const part of report.transferComparison){assert.equal(part.brierDifference,report.metrics[part.withShared].brier-report.metrics[part.base].brier);assert.equal(report.models[part.base].features.length,E.directFeatures.length);assert.equal(report.models[part.withShared].features.length,E.features.length);assert.equal(JSON.stringify(report.models[part.base].settings),JSON.stringify(report.models[part.withShared].settings));}
for(const row of report.evaluationRows){assert.equal(E.predict(roundtrip.models.base_logistic,row.directX),row.base_logistic);assert.equal(E.predictTree(roundtrip.models.base_tree,row.directX),row.base_tree);assert.equal(E.predictBoosted(roundtrip.models.base_boosted,row.directX),row.base_boosted);}
for(const key of ['base_logistic','base_tree','base_boosted'])assert.equal(JSON.stringify(report.models[key]),JSON.stringify(future.models[key]));
assert.ok(report.sharedAnalysis.coverage.skippedFourChoice>0);assert.equal(report.sharedAnalysis.version,'component-transfer-v2');
console.log('PASS: paired same-target feature ablation, six fitted models with reproducible exports, fixed settings and future-label isolation for shared and nonshared models.');
panel.report=roundtrip;panel.paintReport();assert.equal(elements.get('predictionTransferRows').children.length,3);assert.equal(elements.get('predictionTransferComparison').hidden,false);panel.records=records.slice(0,20);panel.paintSummary();assert.equal(elements.get('runPrediction').disabled,true);assert.equal(elements.get('predictionSharedAnalysis').hidden,false);assert.ok(elements.get('predictionSharedTables').children.length>0);assert.ok(elements.get('predictionSharedCoverage').textContent.includes('順番入力'));
const retrain={base_logistic:E.fit(roundtrip.trainingRows.map(r=>({...r,x:r.directX})),roundtrip.models.base_logistic.settings,E.directFeatures),base_tree:E.fitTree(roundtrip.trainingRows.map(r=>({...r,x:r.directX})),roundtrip.models.base_tree.settings,E.directFeatures),base_boosted:E.fitBoosted(roundtrip.trainingRows.map(r=>({...r,x:r.directX})),roundtrip.models.base_boosted.settings,E.directFeatures),logistic:E.fit(roundtrip.trainingRows,roundtrip.models.logistic.settings),tree:E.fitTree(roundtrip.trainingRows,roundtrip.models.tree.settings),boosted:E.fitBoosted(roundtrip.trainingRows,roundtrip.models.boosted.settings)};
for(const key of Object.keys(retrain))assert.equal(JSON.stringify(retrain[key]),JSON.stringify(roundtrip.models[key]));
console.log('PASS: three paired comparisons, component analysis below the fitting guard and all six fitted models reconstructed from report JSON.');
