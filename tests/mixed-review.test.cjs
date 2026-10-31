const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('dist/music-theory.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dist/reference-policy.js','utf8'),ctx);vm.runInContext(fs.readFileSync('dist/practice-model.js','utf8'),ctx);const model=vm.runInContext('PracticeModel',ctx);
const config={task:'chord_identity',preset:'cf',instrument:'piano',duration:1.6,octave:0,guitarStyle:null,reference:true,historyCutoffAt:'2026-10-29T10:00:00Z'};
let serial=0;function record(root,correct,overrides={}){serial++;return{schemaVersion:1,id:'a-'+serial,userId:'local',sessionId:'s',answeredAt:new Date(Date.parse('2026-10-29T00:00:00Z')+serial*1000).toISOString(),answer:correct?root+':major':null,correct,playbackCount:1,responseTimeMs:500,question:{task:'chord_identity',key:'C_major',rootMidi:root,quality:'major',instrument:'piano',duration:1.6,octave:0,options:['60:major','65:major'],notes:[root,root+4,root+7],referenceBeforeQuestion:true,...overrides}};}
const wrong=record(60,false),right=record(65,true);
function seeded(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function assertPlan(plan,cfg){
 assert.equal(plan.items.length,10);assert.equal(plan.items.filter(i=>i.selection.bucket==='weak').length,plan.weakCount);
 const domain=model.trainingDomain(cfg),counts=new Map(domain.map(o=>[o.rootMidi+':'+o.quality,0]));
 let prev=null,run=0;
 for(const item of plan.items){const key=item.solution.rootMidi+':'+item.solution.quality;assert.ok(counts.has(key));if(item.selection.bucket==='normal')counts.set(key,counts.get(key)+1);run=key===prev?run+1:1;prev=key;assert.ok(run<=2,'no target more than twice in a row');assert.ok(item.options.some(o=>o.key===item.solution.key));}
 const values=[...counts.values()];assert.ok(Math.max(...values)-Math.min(...values)<=1,'normal portion is balanced');
}
for(let seed=0;seed<100;seed++){
 const plan=model.buildMixedPlan(config,[wrong,right],seeded(seed));assertPlan(plan,config);assert.equal(plan.weakCount,5);assert.ok(plan.items.filter(i=>i.selection.bucket==='weak').every(i=>i.solution.rootMidi===60));
 const empty=model.buildMixedPlan(config,[],seeded(seed));assertPlan(empty,config);assert.equal(empty.weakCount,0);assert.ok(empty.items.every(i=>i.selection.reason==='no_weak_history'));
 const full={...config,preset:'diatonic'};assertPlan(model.buildMixedPlan(full,[],seeded(seed)),full);
 const quality={...config,task:'chord_quality',mode:'all',roots:[60,65,67]};assertPlan(model.buildMixedPlan(quality,[],seeded(seed)),quality);
 const sevenWrong=model.identityOptions('diatonic').map(o=>record(o.rootMidi,false,{quality:model.qualityIds[o.quality],options:model.identityOptions('diatonic').map(v=>v.key)}));assertPlan(model.buildMixedPlan(full,sevenWrong,seeded(seed)),full);
}
// Old misses stop counting after five more recent correct answers, even with unsorted input.
const recovered=[wrong,...Array.from({length:5},()=>record(60,true)),right];assert.equal(model.buildMixedPlan(config,recovered.reverse(),()=>.5).weakCount,0);
// Never transfer weaknesses across instruments, choices, reference, register, duration or task.
for(const overrides of [{instrument:'guitar',octave:null,guitarStyle:'strum'},{options:['60:major','65:major','67:major']},{referenceBeforeQuestion:false},{octave:12},{duration:.8},{task:'chord_quality',options:['major','minor']}])assert.equal(model.buildMixedPlan(config,[record(60,false,overrides)],()=>.5).weakCount,0);
const future={...wrong,id:'future',answeredAt:'2026-10-30T00:00:00Z'};assert.equal(model.buildMixedPlan(config,[future],()=>.5).weakCount,0);
const recent=[wrong,...Array.from({length:3},()=>record(60,true))];const snapshot=model.buildMixedPlan(config,recent,()=>.5);assert.equal(snapshot.weakCount,5);assert.equal(snapshot.items.find(i=>i.selection.bucket==='weak').selection.priorAttempts,4);
const item=snapshot.items.find(i=>i.selection.bucket==='weak');const exported={...wrong,question:{...wrong.question,selection:item.selection,selectionPolicy:'mixed_review',selectionProbability:null}};
assert.equal(model.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:[exported]}).length,1);
assert.throws(()=>model.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:[{...exported,question:{...exported.question,selection:{...item.selection,priorCorrect:20}}}]}));
assert.ok(model.selectionExplanation(exported).includes('直近4回で3回正解'));
console.log('PASS: 100 randomized plans, 5+5 quotas, balanced normal coverage, max-two streaks, context isolation, recent recovery, chronological cutoff and backup snapshots.');
const guitarConfig={...config,task:'chord_quality',mode:'majorMinor',roots:[60,65,67],instrument:'guitar',octave:null,guitarStyle:'strum'};
const guitarWrong=record(65,false,{task:'chord_quality',key:null,instrument:'guitar',octave:null,guitarStyle:'strum',options:['major','minor'],notes:[41,48,53,57,60,65]});guitarWrong.answer=null;
const guitarPlan=model.buildMixedPlan(guitarConfig,[guitarWrong],seeded(8));assertPlan(guitarPlan,guitarConfig);assert.equal(guitarPlan.weakCount,5);
assert.ok(guitarPlan.items.filter(i=>i.selection.bucket==='weak').every(i=>i.solution.rootMidi===65&&i.solution.quality===0));
const fourOfFive=[record(60,false),...Array.from({length:4},()=>record(60,true))];assert.equal(model.buildMixedPlan(config,fourOfFive,()=>.5).weakCount,0,'80% is not below threshold');
console.log('PASS: quality/guitar weakness, six-target normal coverage, exact 80% boundary.');
