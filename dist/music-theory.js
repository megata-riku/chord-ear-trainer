'use strict';
const MusicTheory=(()=>{
  const letters=['C','D','E','F','G','A','B'],naturals=[0,2,4,5,7,9,11];
  const chromaticNames=['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
  const qualityIds=['major','minor','seven','majseven','diminished'],suffixes=['','m','7','maj7','dim'];
  const intervals=[[0,4,7],[0,3,7],[0,4,7,10],[0,4,7,11],[0,3,6]];
  const pc=n=>((n%12)+12)%12;
  function spell(letterIndex,pitch){let delta=pc(pitch)-naturals[(letterIndex+7)%7];if(delta>6)delta-=12;if(delta< -6)delta+=12;return letters[(letterIndex+7)%7]+(delta>0?'♯'.repeat(delta):'♭'.repeat(-delta));}
  const majorDefinitions=[['C',0,'ハ'],['Db',1,'変ニ'],['D',2,'ニ'],['Eb',3,'変ホ'],['E',4,'ホ'],['F',5,'ヘ'],['Fs',6,'嬰ヘ'],['G',7,'ト'],['Ab',8,'変イ'],['A',9,'イ'],['Bb',10,'変ロ'],['B',11,'ロ']];
  const minorDefinitions=[['A',9,'イ'],['Bb',10,'変ロ'],['B',11,'ロ'],['C',0,'ハ'],['Cs',1,'嬰ハ'],['D',2,'ニ'],['Ds',3,'嬰ニ'],['E',4,'ホ'],['F',5,'ヘ'],['Fs',6,'嬰ヘ'],['G',7,'ト'],['Gs',8,'嬰ト']];
  const keys=[...majorDefinitions.map(d=>makeKey(d,'major')),...minorDefinitions.map(d=>makeKey(d,'natural_minor'))];
  function makeKey([code,pitch,japanese],mode){
    const tonicName=code.replace('b','♭').replace('s','♯'),start=letters.indexOf(code[0]),steps=mode==='major'?[0,2,4,5,7,9,11]:[0,2,3,5,7,8,10];
    const qualities=mode==='major'?[0,1,1,0,0,1,4]:[1,4,0,1,1,0,0];
    return{id:code+'_'+mode,mode,tonic:60+pitch,tonicName,label:japanese+(mode==='major'?'長調':'短調（自然短音階）'),
      scale:steps.map((step,i)=>({rootMidi:60+pc(pitch+step),name:spell((start+i)%7,pitch+step),quality:qualities[i],degree:i+1}))};
  }
  function getKey(id='C_major'){const key=keys.find(k=>k.id===id);if(!key)throw new Error('調の設定を確認してください。');return key;}
  const validKey=id=>keys.some(k=>k.id===id);
  const recordKey=q=>['chord_identity','chord_progression'].includes(q.task)?(q.key||'C_major'):null;
  function rootName(midi,keyId=null){const note=keyId?getKey(keyId).scale.find(n=>pc(n.rootMidi)===pc(midi)):null;return note?.name||chromaticNames[pc(midi)];}
  function chordName(midi,quality,keyId=null){return rootName(midi,keyId)+suffixes[typeof quality==='number'?quality:qualityIds.indexOf(quality)];}
  function chordSpellings(root,quality,keyId=null){
    const rootLabel=rootName(root,keyId),start=letters.indexOf(rootLabel[0]);
    return new Map(intervals[quality].map((interval,i)=>[pc(root+interval),spell((start+i*2)%7,root+interval)]));
  }
  function noteName(midi,keyId=null,chordRoot=null,quality=0){
    const spelling=chordRoot!==null?chordSpellings(chordRoot,quality,keyId).get(pc(midi)):null;
    return spelling||rootName(midi,keyId);
  }
  function fullNoteName(midi,keyId=null,chordRoot=null,quality=0){
    const label=noteName(midi,keyId,chordRoot,quality),writtenPitch=naturals[letters.indexOf(label[0])]+(label.match(/♯/g)||[]).length-(label.match(/♭/g)||[]).length;
    return label+(Math.round((midi-writtenPitch)/12)-1);
  }
  function degrees(keyId,preset='diatonic'){
    const scale=getKey(keyId).scale;return(preset==='cf'?[0,3]:preset==='cfg'?[0,3,4]:[0,1,2,3,4,5,6]).map(i=>({...scale[i]}));
  }
  return{keys,getKey,validKey,recordKey,rootName,chordName,noteName,fullNoteName,degrees,qualityIds,intervals,chromaticNames,pc};
})();
