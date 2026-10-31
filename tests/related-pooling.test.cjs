const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({});for(const f of ['music-theory','reference-policy','practice-model','progression','transfer-analysis','related-pooling','confusion-evidence','prediction-model'])vm.runInContext(fs.readFileSync('dist/'+f+'.js','utf8'),ctx);
const [T,B,E]=vm.runInContext('[MusicTheory,EarPooling,EarPrediction]',ctx),fixed=B.profiles[0];
const chord=(rootMidi,quality='major')=>({rootMidi,quality,notes:T.intervals[T.qualityIds.indexOf(quality)].map(n=>n+rootMidi)});
const q=(c,instrument='guitar',key='C_major')=>({task:'chord_identity',key,instrument,...c,options:['60:major','65:major'],duration:.8,referenceAllowed:false});
const C=chord(60),Am=chord(69,'minor'),D=chord(62),Dm=chord(62,'minor');
assert.equal(B.overlap(C,Am),.5);assert.equal(B.overlap({...C,notes:[60,64,67,72]},Am),.5,'octave duplicates do not affect pitch class overlap');
let serial=0;function observe(state,question,answer){state.observe({id:'s'+serial++,userId:'u',q:question,answer,y:0});}
const state=B.createState();for(let i=0;i<100;i++)observe(state,q(C), '60:major');
const first=state.query(q(Am),'u').evidence[0];assert.equal(first.direct.n,0);assert.equal(first.effectiveCount,4);assert.ok(first.combinedRate>.5);assert.equal(first.sources[0].family,'overlap');
assert.equal(state.query(q(C,'guitar','G_major'),'u').evidence[0].direct.n,100,'same exact chord shares across keys');
assert.equal(state.query(q(C,'electric'),'u').evidence[0].direct.n,0);assert.ok(state.query(q(C,'electric'),'u').evidence[0].effectiveCount>0);
for(const question of [q(C,'piano'),{...q(C),referenceAllowed:true}])assert.equal(state.query(question,'u').evidence[0].effectiveCount,0);
assert.equal(state.query(q(C),'other').evidence[0].direct.n,0);
for(let i=0;i<100;i++)observe(state,q(Am),'65:major');const later=state.query(q(Am),'u').evidence[0];assert.equal(later.direct.n,100);assert.ok(later.influence<first.influence/10);assert.ok(later.effectiveCount<=fixed.cap);
const roots=B.createState();observe(roots,q(D),'62:major');const e=roots.query(q(Dm),'u').evidence[0];assert.equal(e.direct.n,0,'major and minor never merge');assert.ok(e.axes.root.n>0);assert.ok(e.axes.overlap.n>0,'relationships recorded independently');assert.ok(e.related.n<=Math.max(fixed.root,fixed.overlap),'one source cannot be double counted');
const pair=B.createState(),seq={...q(C),task:'chord_progression',progression:{chords:[C,chord(67)],length:2,inputMode:'ordered'}};observe(pair,seq,'60:major|67:major');
const longer={...q(chord(65)),task:'chord_progression',progression:{chords:[chord(65),C,chord(67)],length:3,inputMode:'ordered'}};
assert.equal(pair.query(longer,'u').evidence.find(e=>e.kind==='pair'&&e.position===2).direct.n,1);
const excluded=B.createState();observe(excluded,q(C),'60');observe(excluded,{...seq,progression:{...seq.progression,inputMode:'four'}},'60:major|67:major');observe(excluded,seq,null);assert.equal(excluded.query(seq,'u').evidence[0].direct.n,0);
const records=[];for(let i=0;i<300;i++){
 const key=i%4<2?'C_major':'G_major',instrument=i%2?'guitar':'electric',raw=T.getKey(key).scale[i%7],c={...raw,quality:T.qualityIds[raw.quality]},notes=Array.from(T.intervals[T.qualityIds.indexOf(c.quality)],n=>n+c.rootMidi),options=Array.from(T.getKey(key).scale,n=>n.rootMidi+':'+T.qualityIds[n.quality]),correct=i%3!==0,solution=c.rootMidi+':'+c.quality,time=Date.parse('2026-10-01T00:00:00Z')+Math.floor(i/10)*3600000+(i%10)*10000;
 records.push({schemaVersion:1,id:'pool-qa-'+i,userId:'pool-qa',sessionId:'pool-session-'+Math.floor(i/10),correct,answer:correct?solution:options.find(o=>o!==solution),playbackCount:1,responseTimeMs:900,answeredAt:new Date(time+1000).toISOString(),question:{...q({...c,notes},instrument,key),referenceAllowed:undefined,createdAt:new Date(time).toISOString(),options,selectionPolicy:'uniform'}});
}
const config={userId:'pool-qa',task:'all'},report=E.run(records,config);assert.equal(report.status,'ready');assert.equal(report.selection.status,'selected');
const outerTest=new Set(report.evaluationRows.map(r=>r.id)),outerTrain=new Set(report.trainingRows.map(r=>r.id));for(const id of [...report.selection.trainIds,...report.selection.validationIds]){assert.ok(outerTrain.has(id));assert.ok(!outerTest.has(id));}
for(const value of Object.values(report.selection.byModel)){assert.equal(value.candidates.length,3);assert.ok(value.candidates.every(c=>c.count===report.selection.validationIds.length));}
const changed=records.map(r=>outerTest.has(r.id)?{...r,correct:!r.correct,answer:r.correct?r.question.options.find(o=>o!==r.answer):r.question.rootMidi+':'+r.question.quality}:r),future=E.run(changed,config);
assert.equal(JSON.stringify(report.selection),JSON.stringify(future.selection),'outer future labels cannot select a profile');assert.equal(JSON.stringify(report.models),JSON.stringify(future.models),'all fitted models are frozen including auto profiles');
for(const row of report.evaluationRows){assert.equal(E.predict(report.models.auto_logistic,row.autoX.logistic),row.auto_logistic);assert.equal(E.predictTree(report.models.auto_tree,row.autoX.tree),row.auto_tree);assert.equal(E.predictBoosted(report.models.auto_boosted,row.autoX.boosted),row.auto_boosted);}
assert.equal(report.relationAblations.length,4);for(const a of report.relationAblations)for(const result of Object.values(a.metrics))assert.equal(result.count,report.summary.testCount);
const small=E.run(records.slice(0,100),config);assert.equal(small.selection.status,'deferred');assert.ok(small.selection.reasons.length);for(const v of Object.values(small.selection.byModel))assert.equal(v.selectedProfile,'balanced');
if(process.env.POOL_FIXTURE)fs.writeFileSync(process.env.POOL_FIXTURE,JSON.stringify({format:'ear-lab-history',schemaVersion:1,attempts:records}));
console.log('PASS: bounded partial pooling, key sharing, instrument/permission/user isolation, separate relationship evidence, bidirectional local transfer, nested selection and fallback, untouched future labels, auto-model export reproduction and four refitted relationship comparisons.');
