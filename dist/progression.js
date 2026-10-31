'use strict';
const Progression=(()=>{
  const version='diatonic-progressions-v1',gap=.2;
  const chordKey=c=>c.rootMidi+':'+c.quality;
  const keyOf=chords=>chords.map(chordKey).join('|');
  const options=key=>PracticeModel.identityOptions('diatonic',key);
  const fromOption=o=>({rootMidi:o.rootMidi,quality:PracticeModel.qualityIds[o.quality]});
  function decode(value){return value.split('|').map(k=>{const [rootMidi,quality]=k.split(':');return{rootMidi:Number(rootMidi),quality};});}
  function label(chords,key){return chords.map(c=>MusicTheory.chordName(c.rootMidi,c.quality,key)).join(' → ');}
  function patterns(length,mode){return length===2?[[1,5],[4,1],[2,5],[5,6],[6,4],[5,1]]:mode==='major'?[[1,4,5],[2,5,1],[1,6,4],[6,4,5],[1,5,6],[4,5,1]]:[[1,4,5],[6,7,1],[1,7,6],[4,5,1],[3,7,6],[1,6,7]];}
  // Build a symmetric candidate set before choosing the audible answer.
  // Adjacent positions use disjoint pairs, so every candidate changes chord.
  const candidateVersion='quality-grouped-v1';
  const qualityPattern=chords=>chords.map(c=>c.quality==='major'?'M':'d').join('');
  function sequencePool(length,key){const domain=options(key),pool=[];function walk(chords){if(chords.length===length){pool.push(chords);return;}for(const o of domain)if(!chords.length||chords.at(-1).rootMidi!==o.rootMidi)walk([...chords,fromOption(o)]);}walk([]);return pool;}
  function balancedCandidates(anchor,domain,random){
    const masks=anchor.length===2?[[0,0],[0,1],[1,0],[1,1]]:[[0,0,0],[0,1,1],[1,0,1],[1,1,0]],all=domain.map(fromOption);
    // Prefer four identical broad-quality patterns. If impossible, exactly two pairs.
    for(const allowedChanges of [0,1]){
      let result=null;
      function search(pairs,changed){
        if(pairs.length===anchor.length){result=masks.map(mask=>mask.map((bit,i)=>pairs[i][bit]));return true;}
        const i=pairs.length;
        for(const alternative of PracticeModel.shuffled(all,random)){
          const nextChanged=changed+Number(qualityPattern([alternative])!==qualityPattern([anchor[i]]));
          if(nextChanged>allowedChanges||chordKey(alternative)===chordKey(anchor[i])||(i&&pairs[i-1].some(c=>chordKey(c)===chordKey(alternative)||chordKey(c)===chordKey(anchor[i])))||(i+1<anchor.length&&chordKey(alternative)===chordKey(anchor[i+1])))continue;
          if(search([...pairs,[anchor[i],alternative]],nextChanged))return true;
        }return false;
      }
      if(search([],0))return PracticeModel.shuffled(result,random);
    }
    throw new Error('種類の並びをそろえた候補を作れませんでした。');
  }
  function candidateSet(anchor,mode,key,random=Math.random,pool=sequencePool(anchor.length,key)){
    const candidates=mode==='balanced'?balancedCandidates(anchor,options(key),random):PracticeModel.shuffled(pool.filter(cs=>qualityPattern(cs)===qualityPattern(anchor)),random).slice(0,4);
    if(candidates.length!==4)throw new Error('4候補を準備できませんでした。');
    return candidates.map(chords=>({key:keyOf(chords),chords}));
  }
  function createPlan(length,inputMode,key,random=Math.random){
    const domain=options(key),pool=[],common=patterns(length,MusicTheory.getKey(key).mode);
    function enumerate(chords){if(chords.length===length){pool.push(chords);return;}for(const o of domain)if(!chords.length||chords.at(-1).rootMidi!==o.rootMidi)enumerate([...chords,fromOption(o)]);}
    enumerate([]);
    const commonKeys=new Set(common.map(degrees=>keyOf(degrees.map(d=>fromOption(domain[d-1])))));
    const selected=[...PracticeModel.shuffled(common,random).slice(0,5).map(degrees=>degrees.map(d=>fromOption(domain[d-1]))),...PracticeModel.shuffled(pool.filter(c=>!commonKeys.has(keyOf(c))),random).slice(0,5)];
    const candidateModes=inputMode==='four'?PracticeModel.shuffled(['balanced','balanced','balanced','balanced','balanced','random','random','random','random','random'],random):[];
    const items=PracticeModel.shuffled(selected,random).map((anchor,index)=>{
      const candidateMode=candidateModes[index]||null;
      const candidates=inputMode==='ordered'?null:candidateSet(anchor,candidateMode,key,random,pool).map(o=>o.chords);
      // Do not filter/retry after this draw: each displayed candidate has probability 1/4.
      const chords=candidates?candidates[Math.floor(random()*4)]:anchor;
      const solution={...domain.find(o=>o.rootMidi===chords[0].rootMidi),key:keyOf(chords),chords};
      return{solution,options:inputMode==='ordered'?domain:candidates.map(c=>({key:keyOf(c),chords:c})),selection:null,candidateMode,candidateGrouping:inputMode==='four'?candidateVersion:null,common:commonKeys.has(keyOf(chords))};
    });
    return{policyVersion:inputMode==='four'?'progression-mixed-four-v4':version,weakCount:0,normalCount:10,items};
  }
  function positions(target,answer){return target.map((c,i)=>!!answer&&chordKey(c)===chordKey(answer[i]||{}));}
  function validRecord(a){
    const q=a?.question,p=q?.progression;
    if(q?.task!=='chord_progression'||!p||p.version!==version||![2,3].includes(p.length)||!['four','ordered'].includes(p.inputMode)||!MusicTheory.validKey(q.key)||!Array.isArray(p.chords)||p.chords.length!==p.length||![gap,.1,.35].includes(p.gap))return false;
    if(p.candidateMode!==undefined&&p.candidateMode!==null&&(!['balanced','random'].includes(p.candidateMode)||p.inputMode!=='four'))return false;
    if(p.candidateGrouping!=null&&(p.candidateGrouping!==candidateVersion||p.inputMode!=='four'))return false;
    if(p.candidateGrouping){const counts=new Map();for(const value of q.options||[]){if(typeof value!=='string')return false;const pattern=qualityPattern(decode(value));counts.set(pattern,(counts.get(pattern)||0)+1);}if(!([4].toString()===[...counts.values()].sort().toString()||[2,2].toString()===[...counts.values()].sort().toString()))return false;}
    const domain=options(q.key).map(o=>o.key),validChord=c=>c&&domain.includes(chordKey(c));
    const pitchesMatch=c=>{if(!Array.isArray(c.notes)||c.notes.length<3||c.notes.length>6||c.notes.some(n=>!Number.isInteger(n)||n<40||n>94))return false;const actual=[...new Set(c.notes.map(n=>n%12))].sort(),expected=MusicTheory.intervals[PracticeModel.qualityIds.indexOf(c.quality)].map(n=>(c.rootMidi+n)%12).sort();return actual.length===expected.length&&actual.every((n,i)=>n===expected[i]);};
    let start=0;
    for(const c of p.chords){if(!validChord(c)||!pitchesMatch(c)||!Number.isFinite(c.start)||Math.abs(c.start-start)>.00001||c.duration!==q.duration)return false;start+=c.duration+(['guitar','electric'].includes(q.instrument)&&q.guitarStyle==='strum'?(c.notes.length-1)*.028:0)+p.gap;}
    if(q.rootMidi!==p.chords[0].rootMidi||q.quality!==p.chords[0].quality||JSON.stringify(q.notes)!==JSON.stringify(p.chords[0].notes))return false;
    const validSequence=value=>typeof value==='string'&&value.split('|').length===p.length&&value.split('|').every(k=>domain.includes(k));
    if(!Array.isArray(q.options)||new Set(q.options).size!==q.options.length)return false;
    if(p.inputMode==='four'?(q.options.length!==4||!q.options.every(validSequence)||!q.options.includes(keyOf(p.chords))):(q.options.length!==7||!domain.every(k=>q.options.includes(k))))return false;
    if(a.answer!==null&&(!validSequence(a.answer)||(p.inputMode==='four'&&!q.options.includes(a.answer))))return false;
    if(a.correct!==(a.answer===keyOf(p.chords)))return false;
    if(!Array.isArray(p.positionCorrect)||JSON.stringify(p.positionCorrect)!==JSON.stringify(positions(p.chords,a.answer===null?null:decode(a.answer))))return false;
    if(q.referenceNotes){const k=MusicTheory.getKey(q.key);if(!pitchesMatch({rootMidi:k.tonic,quality:k.mode==='major'?'major':'minor',notes:q.referenceNotes}))return false;}
    if(q.step){const stage=q.step.stage,expected={4:['two_four',2,'four'],5:['two_ordered',2,'ordered'],6:['three_four',3,'four'],7:['three_ordered',3,'ordered']}[stage];if(!expected||q.step.version!=='curriculum-v1'||q.step.preset!==expected[0]||p.length!==expected[1]||p.inputMode!==expected[2]||q.selectionPolicy!=='curriculum'||a.sourceAttemptId)return false;}
    return true;
  }
  return{candidateVersion,qualityPattern,sequencePool,candidateSet,version,gap,chordKey,keyOf,decode,label,createPlan,positions,validRecord};
})();
