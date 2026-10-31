const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const ctx=vm.createContext({});for(const name of ['music-theory','reference-policy','practice-model','guitar','transfer-analysis','related-pooling','confusion-evidence','prediction-model'])vm.runInContext(fs.readFileSync('dist/'+name+'.js','utf8'),ctx);
const theory=vm.runInContext('MusicTheory',ctx),model=vm.runInContext('PracticeModel',ctx),guitar=vm.runInContext('GuitarVoicings',ctx),prediction=vm.runInContext('EarPrediction',ctx);
const pretty=s=>s.replace(/#/g,'♯').replace(/b/g,'♭');
const expected=[
 ['C_major','C Dm Em F G Am Bdim'],['Db_major','Db Ebm Fm Gb Ab Bbm Cdim'],['D_major','D Em F#m G A Bm C#dim'],['Eb_major','Eb Fm Gm Ab Bb Cm Ddim'],['E_major','E F#m G#m A B C#m D#dim'],['F_major','F Gm Am Bb C Dm Edim'],['Fs_major','F# G#m A#m B C# D#m E#dim'],['G_major','G Am Bm C D Em F#dim'],['Ab_major','Ab Bbm Cm Db Eb Fm Gdim'],['A_major','A Bm C#m D E F#m G#dim'],['Bb_major','Bb Cm Dm Eb F Gm Adim'],['B_major','B C#m D#m E F# G#m A#dim'],
 ['A_natural_minor','Am Bdim C Dm Em F G'],['Bb_natural_minor','Bbm Cdim Db Ebm Fm Gb Ab'],['B_natural_minor','Bm C#dim D Em F#m G A'],['C_natural_minor','Cm Ddim Eb Fm Gm Ab Bb'],['Cs_natural_minor','C#m D#dim E F#m G#m A B'],['D_natural_minor','Dm Edim F Gm Am Bb C'],['Ds_natural_minor','D#m E#dim F# G#m A#m B C#'],['E_natural_minor','Em F#dim G Am Bm C D'],['F_natural_minor','Fm Gdim Ab Bbm Cm Db Eb'],['Fs_natural_minor','F#m G#dim A Bm C#m D E'],['G_natural_minor','Gm Adim Bb Cm Dm Eb F'],['Gs_natural_minor','G#m A#dim B C#m D#m E F#']];
assert.equal(theory.keys.length,24);let serial=0;const records=[];
for(const [keyId,names]of expected){
 const key=theory.getKey(keyId),options=model.identityOptions('diatonic',keyId);assert.equal(options.length,7);
 assert.equal(Array.from(options,o=>theory.chordName(o.rootMidi,o.quality,keyId)).join(' '),pretty(names),keyId);
 const scalePcs=new Set(key.scale.map(n=>n.rootMidi%12));assert.equal(scalePcs.size,7);
 for(const option of options){
  const expectedPcs=Array.from(theory.intervals[option.quality],n=>(n+option.rootMidi)%12);assert.ok(expectedPcs.every(n=>scalePcs.has(n)));
  for(const octave of [-12,0,12])for(const midi of theory.intervals[option.quality].map(n=>option.rootMidi+octave+n))assert.ok(fs.existsSync(path.join('dist/audio/piano',midi+'.mp3')),'piano coverage');
  for(const instrument of ['guitar','electric'])for(const midi of guitar.notes(option.rootMidi,option.quality))assert.ok(fs.existsSync(path.join('dist/audio',instrument,midi+'.mp3')),'guitar coverage');
  const count=++serial,notes=Array.from(theory.intervals[option.quality],n=>option.rootMidi+n),refQuality=key.mode==='natural_minor'?1:0;
  const record={schemaVersion:1,id:'key-'+count,userId:'test',sessionId:'keys',answeredAt:'2026-10-29T00:00:02Z',correct:true,answer:option.key,playbackCount:1,responseTimeMs:1000,
    question:{task:'chord_identity',key:keyId,createdAt:'2026-10-29T00:00:00Z',rootMidi:option.rootMidi,quality:theory.qualityIds[option.quality],notes,instrument:'piano',duration:1.6,octave:0,referenceBeforeQuestion:true,referenceNotes:Array.from(theory.intervals[refQuality],n=>key.tonic+n),options:Array.from(options,o=>o.key)}};
  records.push(record);assert.equal(model.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:[record]}).length,1);
 }
 for(const preset of ['cf','cfg','diatonic']){
  const domain=model.identityOptions(preset,keyId),generated=model.generateIdentity(preset,()=>.9999,keyId);assert.equal(generated.solution.key,domain.at(-1).key);
  const plan=model.buildMixedPlan({task:'chord_identity',preset,key:keyId,instrument:'piano',duration:1.6,octave:0,reference:true},[]);assert.equal(plan.items.length,10);assert.ok(plan.items.every(i=>domain.some(o=>o.key===i.solution.key)));
 }
}
const cInC=records.find(a=>a.question.key==='C_major'&&a.question.rootMidi===60),cInF=records.find(a=>a.question.key==='F_major'&&a.question.rootMidi===60);
assert.ok(cInC&&cInF);const wrongC={...cInC,id:'wrong-c',correct:false,answer:null};
assert.equal(model.buildMixedPlan({task:'chord_identity',preset:'diatonic',key:'F_major',instrument:'piano',duration:1.6,octave:0,reference:true},[wrongC]).weakCount,0,'weakness is isolated by key');
assert.notEqual(prediction.conditionKey(cInC.question),prediction.conditionKey(cInF.question));
const rows=prediction.buildRows(prediction.prepare([cInF]).eligible);assert.equal(rows[0].x[prediction.features.indexOf('tonic_pc_5')],1);assert.equal(rows[0].x[prediction.features.indexOf('scale_degree_5')],1);
assert.equal(prediction.prepare(records,{key:'A_natural_minor'}).summary.eligible,7);
const cMinor={...cInC,id:'minor-context',question:{...cInC.question,key:'A_natural_minor'}};assert.equal(model.reviewQueue([wrongC,{...cMinor,answer:null,correct:false}]).length,2,'same C chord in different keys remains distinct in review');
const invalid={...cInC,question:{...cInC.question,key:'bad_key'}};assert.throws(()=>model.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:[invalid]}));
assert.throws(()=>model.validateBackup({format:'ear-lab-history',schemaVersion:1,attempts:[{...cInF,question:{...cInF.question,referenceNotes:[60,64,67]}}]}),'wrong tonic reference rejected');
assert.equal(theory.noteName(65,'Fs_major',65,4),'E♯');assert.equal(theory.fullNoteName(71,null,61,2),'C♭5');
const chromatic=model.trainingDomain({task:'chord_quality',mode:'all',roots:Array.from({length:12},(_,i)=>60+i)});assert.equal(chromatic.length,48);
console.log('PASS: all 24 scales / 168 diatonic triads, 2/3/7-choice generation, key-isolated review, 12-root domain, spelling and reference integrity, all piano registers and guitar sample coverage, prediction key/degree features.');

assert.equal(model.buildMixedPlan({task:'chord_identity',preset:'diatonic',key:'A_natural_minor',instrument:'piano',duration:1.6,octave:0,reference:true},[wrongC]).weakCount,0,'relative major/minor with identical option sets still have separate contexts');
