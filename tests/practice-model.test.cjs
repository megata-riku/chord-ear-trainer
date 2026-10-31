const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/music-theory.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/reference-policy.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/practice-model.js'),'utf8'),context);
const model = vm.runInContext('PracticeModel',context);
for(const mode of Object.keys(model.modes)){
 const first=model.generate(mode,[60,65,67],()=>0);
 const last=model.generate(mode,[60,65,67],()=>.99999);
 assert.equal(first.root,60);assert.equal(last.root,67);
 assert.equal(first.quality,model.modes[mode][0]);
 assert.equal(last.quality,model.modes[mode][model.modes[mode].length-1]);
 assert.equal(first.selectionProbability,1/(3*model.modes[mode].length));
 assert.deepEqual([...first.options].sort(),[...model.modes[mode]].sort());
}
const record={schemaVersion:1,id:'answer-1',userId:'local',sessionId:'session',answeredAt:'2026-10-29T00:00:00Z',answer:'minor',correct:false,playbackCount:2,responseTimeMs:2300,
 question:{rootMidi:65,quality:'major',instrument:'guitar',notes:[41,48,53,57,60,65],duration:1.6,options:['minor','major']}};
const backup={format:'ear-lab-history',schemaVersion:1,attempts:[record]};
assert.equal(model.validateBackup(backup).length,1);
assert.throws(()=>model.validateBackup({...backup,attempts:[record,record]}),/形式/);
assert.throws(()=>model.validateBackup({...backup,attempts:[{...record,correct:true}]}),/形式/);
assert.throws(()=>model.validateBackup({...backup,attempts:[{...record,playbackCount:0}]}),/形式/);
assert.throws(()=>model.validateBackup({...backup,attempts:[{...record,question:{...record.question,instrument:'<script>'}}]}),/形式/);
assert.throws(()=>model.validateBackup({format:'other'}),/JSON/);
console.log('PASS: all practice modes, choice sets, root ranges, selection probabilities, validated restores and malformed backups.');
