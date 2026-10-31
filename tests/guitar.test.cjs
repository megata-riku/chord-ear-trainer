const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/guitar.js'), 'utf8'), context);
const guitar = vm.runInContext('GuitarVoicings', context);
const roots = Array.from({length:12},(_,i)=>60+i);
const intervals = [[0,4,7],[0,3,7],[0,4,7,10],[0,4,7,11],[0,3,6]];
for (const root of roots) for (let quality=0; quality<5; quality++) {
  const strings = guitar.strings(root,quality);
  const notes = Array.from(guitar.notes(root,quality));
  assert.equal(strings.length,6);
  assert.ok(notes.length>=4 && notes.length<=6);
  const actual = [...new Set(notes.map(n=>(n-root+120)%12))].sort((a,b)=>a-b);
  assert.deepEqual(actual,intervals[quality],`complete chord: root ${root}, quality ${quality}`);
  const fretted = Array.from(strings).filter(s=>s.fret>0).map(s=>s.fret);
  assert.ok(Math.max(...fretted)-Math.min(...fretted)<=3, 'compact, playable shape');
  for (const midi of notes) for (const instrument of ['guitar','electric']) {
    assert.ok(fs.existsSync(path.join(__dirname,`../dist/audio/${instrument}/${midi}.mp3`)),`sample ${instrument}/${midi}`);
  }
}
assert.deepEqual(Array.from(guitar.notes(65,0)),[41,48,53,57,60,65]);
assert.deepEqual(Array.from(guitar.notes(65,2)),[41,48,51,57,60,65]);
assert.equal(guitar.notes(62,0).length,4,'D uses four strings');
console.log('PASS: 60 guitar shapes, full chord identities, string counts, fret spans, audio coverage, F / F7 voicing.');

assert.deepEqual(Array.from(guitar.notes(71,4)),[47,53,59,62]);
