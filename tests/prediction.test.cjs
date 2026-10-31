const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('dist/music-theory.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dist/reference-policy.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dist/transfer-analysis.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dist/related-pooling.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dist/confusion-evidence.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dist/prediction-model.js','utf8'),ctx);const model=vm.runInContext('EarPrediction',ctx);
vm.runInContext(fs.readFileSync('dist/practice-model.js','utf8'),ctx);const practice=vm.runInContext('PracticeModel',ctx);
const config={userId:'prediction-qa',task:'all'};
function fixture(n=120){return Array.from({length:n},(_,i)=>{
 const session=Math.floor(i/10),time=Date.parse('2026-10-20T00:00:00Z')+session*3600000+(i%10)*3000,root=i%2?65:60,correct=root===60;
 return{schemaVersion:1,id:'prediction-qa-'+i,userId:config.userId,sessionId:'prediction-session-'+session,sessionStartedAt:new Date(time-(i%10)*3000).toISOString(),answeredAt:new Date(time+1000).toISOString(),correct,answer:correct?root+':major':null,playbackCount:1,firstPlaybackAt:new Date(time+100).toISOString(),responseTimeMs:900,
 question:{id:'prediction-qa-'+i,task:'chord_identity',createdAt:new Date(time).toISOString(),key:'C_major',rootMidi:root,quality:'major',instrument:'piano',duration:1.6,octave:0,notes:[root,root+4,root+7],options:['60:major','65:major'],referenceBeforeQuestion:false,selectionPolicy:'uniform'}};
});}
const records=fixture(),report=model.run(records,config);assert.equal(report.status,'ready');
assert.equal(report.summary.trainCount+report.summary.testCount,120);assert.equal(report.summary.boundaryExcluded,0);
const trainSessions=new Set(report.trainingRows.map(r=>r.sessionId));assert.ok(report.evaluationRows.every(r=>!trainSessions.has(r.sessionId)));
assert.ok(report.trainingRows.every(r=>Date.parse(r.answeredAt)<Date.parse(report.protocol.cutoff)));
assert.ok(report.evaluationRows.every(r=>Date.parse(r.predictedAt)>=Date.parse(report.protocol.cutoff)));
assert.ok(report.metrics.logistic.logLoss<report.metrics.global.logLoss,'regression learns the predictable root signal');
assert.ok(report.model.weights.every(Number.isFinite));assert.equal(report.model.weights.length,model.features.length);
const testIds=new Set(report.evaluationRows.map(r=>r.id));
const changed=records.map(r=>testIds.has(r.id)?{...r,correct:!r.correct}:r);const changedReport=model.run(changed,config);
assert.deepEqual(Array.from(report.model.weights),Array.from(changedReport.model.weights),'future test labels cannot change training weights');
assert.equal(report.model.intercept,changedReport.model.intercept);assert.equal(report.protocol.cutoff,changedReport.protocol.cutoff);
assert.equal(report.evaluationRows[0].logistic,changedReport.evaluationRows[0].logistic,'first test prediction cannot use test labels');
const modified=records.map(r=>({...r,responseTimeMs:999999,playbackCount:200,referencePlaybackCount:100}));
const modifiedReport=model.run(modified,config);assert.deepEqual(Array.from(report.model.weights),Array.from(modifiedReport.model.weights),'post-question behavior is not a feature');
const again=model.run([...records].reverse(),config);assert.deepEqual(Array.from(report.model.weights),Array.from(again.model.weights),'deterministic and independent of IndexedDB order');
const eventRows=[{id:'a',sessionId:'s',time:0,answered:100,y:0,key:'k',q:records[0].question,task:'chord_identity'},
 {id:'b',sessionId:'s',time:10,answered:11,y:1,key:'k',q:records[0].question,task:'chord_identity'},
 {id:'c',sessionId:'s',time:20,answered:21,y:0,key:'k',q:records[0].question,task:'chord_identity'}];
const causal=model.buildRows(eventRows);assert.equal(causal[1].priorCount,0);assert.equal(causal[2].priorCount,1);assert.equal(causal[2].global,2/3);
const m=model.metrics([{y:1,p:.5},{y:0,p:.5}],'p');assert.equal(m.brier,.25);assert.ok(Math.abs(m.logLoss-Math.log(2))<1e-12);
assert.equal(model.calibration([{logistic:1,y:1}])[4].count,1);
assert.equal(model.run(fixture(20),config).status,'insufficient');
assert.equal(model.run(records.map(r=>({...r,correct:true})),config).status,'insufficient');
assert.equal(model.run(records.map(r=>({...r,sessionId:'one-session'})),config).status,'insufficient');
const missing=records.map(r=>({...r,firstPlaybackAt:null,question:{...r.question,createdAt:null}}));assert.equal(model.prepare(missing,config).summary.excluded.missingTime,120);
const other=records.map(r=>({...r,id:r.id+'-other',userId:'other',correct:!r.correct}));assert.equal(model.run([...records,...other],config).summary.eligible,120);assert.equal(model.run([...records,...other],{task:'all'}).status,'insufficient');
const overlapping=records.map((r,i)=>i===50?{...r,answeredAt:'2026-10-20T11:30:00Z'}:r),overlap=model.run(overlapping,config);
assert.equal(overlap.status,'ready');assert.ok(overlap.summary.boundaryExcluded>0);assert.ok(overlap.trainingRows.every(r=>Date.parse(r.answeredAt)<Date.parse(overlap.protocol.cutoff)));
const backup={format:'ear-lab-history',schemaVersion:1,attempts:records};assert.equal(practice.validateBackup(backup).length,120);
if(process.env.PREDICTION_FIXTURE)fs.writeFileSync(process.env.PREDICTION_FIXTURE,JSON.stringify(backup));
console.log('PASS: learned probability signal, session/time holdout, frozen test weights, causal features with overlapping answers, no response/replay leakage, deterministic fits, metric formulas, insufficient/single-class data, user isolation, valid QA backup.');
