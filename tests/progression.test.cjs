const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({});for(const f of ['music-theory','reference-policy','practice-model','progression','curriculum','guitar','transfer-analysis','related-pooling','confusion-evidence','prediction-model'])vm.runInContext(fs.readFileSync('dist/'+f+'.js','utf8'),ctx);
const [P,M,C,T,G,E]=vm.runInContext('[Progression,PracticeModel,Curriculum,MusicTheory,GuitarVoicings,EarPrediction]',ctx);
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function records(stage,key='C_major',instrument='piano',score=9,id='progression-'+stage){
 const plan=C.createPlan(stage,key,random(stage));
 return Array.from(plan.items,(item,i)=>{
  const progression=stage>=4;let time=0;
  const chords=progression?item.solution.chords.map(c=>{const notes=['guitar','electric'].includes(instrument)?Array.from(G.notes(c.rootMidi,T.qualityIds.indexOf(c.quality))):Array.from(T.intervals[T.qualityIds.indexOf(c.quality)],n=>n+c.rootMidi);const v={...c,notes,start:time,duration:.8};time+=.8+(['guitar','electric'].includes(instrument)?(notes.length-1)*.028:0)+P.gap;return v;}):null;
  const first=progression?chords[0]:{rootMidi:item.solution.rootMidi,quality:T.qualityIds[item.solution.quality],notes:Array.from(T.intervals[item.solution.quality],n=>n+item.solution.rootMidi)};
  const answer=i<score?item.solution.key:null,now=Date.parse('2026-10-29T00:00:00Z')+stage*3600000+i*3000;
  return{schemaVersion:1,id:id+'-'+i,sessionId:id,userId:'progression-qa',answeredAt:new Date(now+2000).toISOString(),answer,correct:i<score,playbackCount:1,responseTimeMs:1000,
   question:{task:progression?'chord_progression':'chord_identity',key,...first,instrument,duration:.8,guitarStyle:['guitar','electric'].includes(instrument)?'strum':null,octave:['guitar','electric'].includes(instrument)?null:0,createdAt:new Date(now).toISOString(),options:Array.from(item.options,o=>o.key),step:{version:C.version,stage,preset:C.stages[stage-1].preset},selectionPolicy:'curriculum',referenceBeforeQuestion:false,
    ...(progression?{progression:{version:P.version,length:chords.length,inputMode:[4,6].includes(stage)?'four':'ordered',gap:P.gap,chords,candidateMode:item.candidateMode,positionCorrect:Array.from(P.positions(chords,answer?P.decode(answer):null))}}:{})}};
 });
}
for(const key of T.keys)for(const stage of [4,5,6,7])for(let seed=0;seed<10;seed++){
 const plan=C.createPlan(stage,key.id,random(seed)),len=stage<=5?2:3,domain=M.identityOptions('diatonic',key.id).map(o=>o.key);assert.equal(plan.items.length,10);
 if([5,7].includes(stage)){assert.equal(new Set(Array.from(plan.items,i=>i.solution.key)).size,10);assert.equal(plan.items.filter(i=>i.common).length,5);}
 if([4,6].includes(stage)){assert.equal(plan.items.filter(i=>i.candidateMode==='balanced').length,5);assert.equal(plan.items.filter(i=>i.candidateMode==='random').length,5);}
 for(const item of plan.items){assert.equal(item.solution.chords.length,len);assert.ok(item.solution.chords.every(c=>domain.includes(P.chordKey(c))));assert.equal(item.options.length,[4,6].includes(stage)?4:7);
 if([4,6].includes(stage)){assert.equal(new Set(Array.from(item.options,o=>o.key)).size,4);assert.ok(item.options.some(o=>o.key===item.solution.key));
  if(item.candidateMode==='balanced'){for(let pos=0;pos<len;pos++){const counts=new Map();for(const o of item.options){const k=P.chordKey(o.chords[pos]);counts.set(k,(counts.get(k)||0)+1);}assert.equal(counts.size,2);assert.ok([...counts.values()].every(n=>n===2));}
  const totals=Array.from(item.options,a=>item.options.reduce((sum,b)=>sum+a.chords.filter((c,i)=>P.chordKey(c)===P.chordKey(b.chords[i])).length,0));assert.ok(totals.every(n=>n===totals[0]));}
  for(const o of item.options)for(let pos=1;pos<len;pos++)assert.notEqual(P.chordKey(o.chords[pos-1]),P.chordKey(o.chords[pos]));}
 for(let i=1;i<len;i++)assert.notEqual(item.solution.chords[i-1].rootMidi,item.solution.chords[i].rootMidi);
 }
}
for(const key of T.keys)for(const instrument of ['piano','guitar','electric'])for(const stage of [4,5,6,7]){
 const rows=records(stage,key.id,instrument);assert.ok(rows.every(r=>P.validRecord(r)));M.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:rows});
}
const all=Array.from({length:7},(_,i)=>records(i+1)).flat(),scope={key:'C_major',instrument:'piano'};
assert.ok(C.progress(all,scope).every(s=>s.passed));
const firstThree=all.filter(a=>a.question.step.stage<=3);
assert.equal(C.progress([...firstThree,...records(4,'C_major','piano',8,'fail4')],scope)[4].unlocked,false);
assert.equal(C.progress([...firstThree,...records(4).slice(0,9)],scope)[4].unlocked,false);
assert.equal(C.progress([...firstThree,...records(4)],scope)[4].unlocked,true);
assert.equal(C.progress(all.map(r=>({...r,sourceAttemptId:'original'})),scope)[0].passed,false);
const one=records(5)[0],wrong=structuredClone(one);wrong.answer=wrong.answer.split('|').reverse().join('|');wrong.correct=false;wrong.question.progression.positionCorrect=Array.from(P.positions(wrong.question.progression.chords,P.decode(wrong.answer)));assert.equal(P.validRecord(wrong),true);assert.ok(wrong.question.progression.positionCorrect.every(c=>!c));
for(const mutate of [r=>r.question.progression.chords[1].start=0,r=>r.question.progression.chords[1].notes[0]++,r=>r.question.progression.positionCorrect=[true,false],r=>r.answer='60:major',r=>r.question.step.stage=4]){
 const bad=structuredClone(one);mutate(bad);assert.throws(()=>M.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:[bad]}));
}
const prepared=E.prepare(all,{userId:'progression-qa'});assert.equal(prepared.eligible.length,70);assert.equal(prepared.summary.excluded.unsupported,0);
if(process.env.STEP_FIXTURE){fs.mkdirSync(process.env.STEP_FIXTURE,{recursive:true});fs.writeFileSync(process.env.STEP_FIXTURE+'/progression-unlocks.json',JSON.stringify({format:'ear-lab-history',schemaVersion:1,attempts:all.filter(a=>a.question.step.stage<=6)}));}
console.log('PASS: 960 progression plans across 24 keys, unique/correct distractors, common patterns, all guitar voicings, sequence/order grading, per-position feedback, corrupt backups, 9/10 unlocks, history restoration and separate prediction eligibility.');

// Freeze all generation draws except the final correct-answer draw of each question.
// The same visible candidates must permit each of the four answers equally.
for(const length of [2,3])for(const initial of [.1,.4,.8]){
 let calls=0;const baseline=P.createPlan(length,'four','C_major',()=>{calls++;return initial;});
 for(const target of [.125,.375,.625,.875]){
  let index=0;const plan=P.createPlan(length,'four','C_major',()=>++index===calls?target:initial);
  const item=plan.items.at(-1);assert.equal(JSON.stringify(item.options),JSON.stringify(baseline.items.at(-1).options));assert.equal(item.solution.key,item.options[Math.floor(target*4)].key);
 }
}
// Independently randomized sets are not constrained to balanced column counts.
for(const length of [2,3]){
 const items=P.createPlan(length,'four','C_major',random(123)).items.filter(i=>i.candidateMode==='random');
 assert.ok(items.some(item=>Array.from({length},(_,pos)=>new Set(Array.from(item.options,o=>P.chordKey(o.chords[pos]))).size).some(n=>n!==2)));
}
const html=fs.readFileSync('dist/index.html','utf8'),practice=fs.readFileSync('dist/practice.js','utf8');
assert.ok(!html.includes('id="referenceBeforeQuestion"'));assert.ok(!practice.includes("$('referenceBeforeQuestion')"));
console.log('PASS: exact 5/5 candidate-mode quotas, balanced position counts and overlap, unrestricted random candidates, no adjacent repeats, fixed candidate sets with each of four equally selectable answers, and no automatic-reference setting.');

assert.equal(P.gap,.2);
for(const legacyGap of [.1,.35]){
 const legacyGapRows=records(6).map(row=>{const r=structuredClone(row);r.question.progression.gap=legacyGap;r.question.progression.chords.forEach((c,i)=>c.start+=i*(legacyGap-P.gap));return r;});
 M.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:legacyGapRows});
 const invalidGap=structuredClone(legacyGapRows[0]);invalidGap.question.progression.gap=.25;assert.equal(P.validRecord(invalidGap),false);
}
assert.ok(practice.includes('sourceProgression?.gap??Progression.gap'));assert.ok(practice.includes('strumSpan(notes)+q.progression.gap'));
console.log('PASS: new 0.2-second spacing, legacy 0.1/0.35-second timing import and preserved review/answer playback spacing.');

// Broad-quality patterns are four identical patterns or two pairs, across all keys/modes.
let groupedPairs=0,nonFixedDim=0;
for(const key of T.keys)for(const length of [2,3])for(let seed=0;seed<12;seed++)for(const item of P.createPlan(length,'four',key.id,random(seed+100)).items){
 assert.equal(item.candidateGrouping,'quality-grouped-v1');const groups=new Map();for(const o of item.options){const shape=P.qualityPattern(o.chords);groups.set(shape,(groups.get(shape)||0)+1);}assert.ok([...groups.values()].every(n=>n===4||n===2));if(groups.size===2)groupedPairs++;
 for(let pos=0;pos<length;pos++){const column=item.options.map(o=>o.chords[pos]);if(column.some(c=>c.quality==='diminished')&&column.some(c=>c.quality==='minor'))nonFixedDim++;}
}
assert.ok(groupedPairs>0);assert.ok(nonFixedDim>0,'minor/dim grouping permits dim to vary');
const tagged=records(4)[0];tagged.question.progression.candidateGrouping=P.candidateVersion;assert.ok(P.validRecord(tagged));tagged.question.progression.candidateGrouping='unknown';assert.equal(P.validRecord(tagged),false);
console.log('PASS: four same broad-quality patterns or two pairs, minor/dim flexibility, balanced columns and old/new candidate provenance.');
