const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({});for(const file of ['music-theory','reference-policy','practice-model','progression','curriculum'])vm.runInContext(fs.readFileSync('dist/'+file+'.js','utf8'),ctx);
const curriculum=vm.runInContext('Curriculum',ctx),model=vm.runInContext('PracticeModel',ctx),theory=vm.runInContext('MusicTheory',ctx);
const scope={key:'C_major',instrument:'piano'};
function seeded(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function run(stage,score,id='run-'+stage,key=scope.key,instrument=scope.instrument){
 const preset=curriculum.stages[stage-1].preset,plan=curriculum.createPlan(stage,key,seeded(7));
 return Array.from(plan.items,(item,i)=>{const correct=i<score,now=Date.parse('2026-10-29T00:00:00Z')+stage*3600000+i*3000;return{
 schemaVersion:1,id:id+'-'+i,userId:'step-qa',sessionId:id,sessionStartedAt:new Date(now-i*3000).toISOString(),answeredAt:new Date(now+1000).toISOString(),answer:correct?item.solution.key:null,correct,playbackCount:1,responseTimeMs:900,sourceAttemptId:null,
 question:{task:'chord_identity',key,rootMidi:item.solution.rootMidi,quality:theory.qualityIds[item.solution.quality],createdAt:new Date(now).toISOString(),notes:Array.from(theory.intervals[item.solution.quality],n=>item.solution.rootMidi+n),instrument,duration:1.6,octave:0,options:Array.from(item.options,o=>o.key),referenceBeforeQuestion:false,step:{version:curriculum.version,stage,preset},selectionPolicy:'curriculum',generatorVersion:'curriculum-v1'}};});
}
const fail=run(1,8,'failed'),pass=run(1,9,'passed');
let p=curriculum.progress([],scope);assert.equal(p[0].unlocked,true);assert.equal(p[1].unlocked,false);
assert.equal(curriculum.progress(fail,scope)[1].unlocked,false,'8/10 does not unlock');
assert.equal(curriculum.progress(pass.slice(0,9),scope)[1].unlocked,false,'9 correct without completing 10 does not unlock');
p=curriculum.progress(pass,scope);assert.equal(p[0].passed,true);assert.equal(p[1].unlocked,true);assert.equal(p[2].unlocked,false);
assert.equal(curriculum.progress([...pass,...fail],scope)[0].passed,true,'later failure does not revoke achievement');
assert.equal(curriculum.progress(pass.map(a=>({...a,sourceAttemptId:'original'})),scope)[1].unlocked,false,'manual review cannot unlock');
assert.equal(curriculum.progress(pass.map(a=>({...a,question:{...a.question,step:null}})),scope)[1].unlocked,false,'free practice cannot unlock');
assert.equal(curriculum.progress([...pass,...pass],scope)[0].completedCount,1,'duplicate answers cannot create additional runs');
assert.equal(curriculum.progress(pass,{...scope,instrument:'guitar'})[1].unlocked,false);
assert.equal(curriculum.progress(pass,{...scope,key:'A_natural_minor'})[1].unlocked,false);
assert.equal(curriculum.progress(run(3,10,'orphan'),scope)[2].passed,false,'cannot skip prerequisite stages');
const firstTwo=[...pass,...run(2,9,'passed-2')];assert.equal(curriculum.progress(firstTwo,scope)[2].unlocked,true);
p=curriculum.progress([...firstTwo,...run(3,9,'passed-3')],scope);assert.ok(p.slice(0,3).every(s=>s.passed));assert.equal(p[3].unlocked,true);assert.ok(p.slice(4).every(s=>s.implemented&&!s.unlocked));
assert.equal(curriculum.createPlan(4,'C_major').items.length,10);
const backup={format:'ear-lab-history',schemaVersion:1,attempts:firstTwo};model.validateBackup(backup);
const restored=model.validateBackup(JSON.parse(JSON.stringify(backup)));assert.equal(curriculum.progress(restored,scope)[2].unlocked,true,'unlock state reconstructs from backup');
assert.throws(()=>model.validateBackup({...backup,attempts:[{...pass[0],question:{...pass[0].question,step:{version:'curriculum-v1',stage:99,preset:'cfg'}}}]}));
for(const key of theory.keys)for(const stage of [1,2,3])for(let seed=0;seed<20;seed++){
 const plan=curriculum.createPlan(stage,key.id,seeded(seed));assert.equal(plan.items.length,10);const count=new Map();let previous='',streak=0;
 for(const item of plan.items){assert.equal(item.options.length,stage===1?3:stage===2?4:7);assert.equal(new Set(item.options.map(o=>o.key)).size,item.options.length);assert.ok(item.options.some(o=>o.key===item.solution.key));count.set(item.solution.key,(count.get(item.solution.key)||0)+1);streak=item.solution.key===previous?streak+1:1;assert.ok(streak<=2);previous=item.solution.key;}
 assert.equal(count.size,stage===1?3:7,'every target chord is covered');assert.ok(Math.max(...count.values())-Math.min(...count.values())<=1);
}
const generated=model.generateIdentity('diatonic4',()=>.4,'C_major');assert.equal(generated.options.length,4);assert.equal(generated.selectionProbability,1/7);
if(process.env.STEP_FIXTURE){for(const [name,records]of [['pass-one',pass],['fail-two',run(2,8,'failed-two')],['pass-two',run(2,9,'passed-two')]])fs.writeFileSync(process.env.STEP_FIXTURE+'/'+name+'.json',JSON.stringify({format:'ear-lab-history',schemaVersion:1,attempts:records}));}
console.log('PASS: 9/10 threshold, 8/10 and incomplete/review rejection, prerequisite order, nonrevoking achievements, key/instrument isolation, backup restoration and 1,440 balanced 3/4/7-choice plans across all 24 keys.');
