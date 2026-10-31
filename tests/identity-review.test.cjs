const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/music-theory.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/reference-policy.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/practice-model.js'),'utf8'),context);const model=vm.runInContext('PracticeModel',context);
const cf=model.generateIdentity('cf',()=>0),last=model.generateIdentity('cf',()=>.9999);
assert.equal(cf.solution.key,'60:major');assert.equal(last.solution.key,'65:major');assert.equal(cf.selectionProbability,.5);
assert.deepEqual(Array.from(model.identityOptions('cfg'),o=>o.rootMidi),[60,65,67]);
assert.equal(model.identityOptions('diatonic').length,7);assert.equal(model.identityOptions('diatonic')[6].key,'71:diminished');
const a={schemaVersion:1,id:'identity-1',userId:'local',sessionId:'session',answeredAt:'2026-10-29T00:00:00Z',answer:'65:major',correct:false,playbackCount:1,responseTimeMs:2000,
question:{task:'chord_identity',rootMidi:60,quality:'major',instrument:'piano',notes:[60,64,67],duration:1.6,octave:0,options:['60:major','65:major']}};
const backup={format:'ear-lab-history',schemaVersion:1,attempts:[a]};assert.equal(model.validateBackup(backup).length,1);
assert.throws(()=>model.validateBackup({...backup,attempts:[{...a,correct:true}]}),'C and F must not grade equal just because both are major');
const correct={...a,id:'correct',correct:true,answer:'60:major'};
const duplicate={...a,id:'repeat'};const other={...a,id:'other',question:{...a.question,rootMidi:65,notes:[65,69,72]}};
const queue=model.reviewQueue([a,correct,duplicate,other],10,()=>0);
assert.equal(queue.length,2);assert.ok(queue.every(r=>!r.correct));assert.ok(!Array.from(queue,r=>r.id).includes('identity-1'),'latest duplicate retained');
assert.equal(model.decodeOption('65:major',60,'chord_identity').rootMidi,65);
assert.equal(model.decodeOption('minor',65,'chord_quality').quality,1);
console.log('PASS: C / F root grading, all seven diatonic chords, key-mode backups, backward option decoding, missed-only deduplicated review queue.');
