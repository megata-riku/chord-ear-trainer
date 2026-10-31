'use strict';
// Weak relationships are evidence, never merged chord identities.
const EarPooling=(()=>{
 const version='bounded-related-evidence-v1';
 const families=['instrument','role','root','overlap'];
 const directProfile={id:'direct',cap:0,instrument:0,role:0,root:0,overlap:0,pairScale:0};
 const profiles=[{id:'balanced',label:'標準',cap:4,instrument:.6,role:.12,root:.10,overlap:.08,pairScale:.5},{id:'weak',label:'控えめ',cap:2,instrument:.35,role:.06,root:.05,overlap:.04,pairScale:.5},{id:'strong',label:'広め',cap:6,instrument:.8,role:.18,root:.15,overlap:.12,pairScale:.5}];
 const fields=['direct_rate','direct_count','related_rate','effective_count','influence','combined_rate',...families.flatMap(f=>[f+'_rate',f+'_count'])];
 const features=[...Array.from({length:3},(_,i)=>fields.map(f=>'pool_code_'+(i+1)+'_'+f)).flat(),...Array.from({length:2},(_,i)=>fields.map(f=>'pool_pair_'+(i+1)+'_'+f)).flat()];
 const pc=n=>((n%12)+12)%12,id=c=>pc(c.rootMidi)+':'+c.quality;
 const pitches=c=>new Set(MusicTheory.intervals[MusicTheory.qualityIds.indexOf(c.quality)].map(n=>pc(c.rootMidi+n)));
 function overlap(a,b){const A=pitches(a),B=pitches(b),intersection=[...A].filter(n=>B.has(n)).length;return intersection/(A.size+B.size-intersection);}
 const role=(c,key)=>{const k=key?MusicTheory.getKey(key):null;return k?.scale.find(n=>pc(n.rootMidi)===pc(c.rootMidi))?.degree||0;};
 const guitar=(a,b)=>a!==b&&['guitar','electric'].includes(a)&&['guitar','electric'].includes(b);
 function relation(a,b,target,source,p){
  if(id(a)===id(b))return target.instrument===source.instrument?{weight:1,family:'direct'}:guitar(target.instrument,source.instrument)?{weight:p.instrument,family:'instrument'}:{weight:0};
  if(target.instrument!==source.instrument)return{weight:0};
  const candidates=[{family:'role',weight:role(a,target.key)>0&&role(a,target.key)===role(b,source.key)&&MusicTheory.getKey(target.key).mode===MusicTheory.getKey(source.key).mode&&a.quality===b.quality?p.role:0},{family:'root',weight:pc(a.rootMidi)===pc(b.rootMidi)?p.root:0},{family:'overlap',weight:p.overlap*overlap(a,b)}];
  return {...[...candidates].sort((a,b)=>b.weight-a.weight)[0],weights:Object.fromEntries(candidates.map(c=>[c.family,c.weight]))};
 }
 function createState(){
  const buckets=new Map(),seen=new Set();
  function observe(r){
   if(seen.has(r.id))return;seen.add(r.id);const q=r.q;
   if(q.task!=='chord_identity'&&!(q.task==='chord_progression'&&q.progression.inputMode==='ordered'&&r.answer!=null))return;
   const chords=q.progression?.chords||[{rootMidi:q.rootMidi,quality:q.quality}],selected=typeof r.answer==='string'?r.answer.split('|'):[];
   if(r.answer!=null&&typeof r.answer!=='string')return;
   if(selected.length&&(selected.length!==chords.length||selected.some(label=>{const [root,quality]=label.split(':');return !Number.isFinite(Number(root))||!MusicTheory.qualityIds.includes(quality);})))return;
   const ok=chords.map((c,i)=>selected[i]===c.rootMidi+':'+c.quality),meta={userId:r.userId,key:MusicTheory.recordKey(q),instrument:q.instrument,permission:ReferencePolicy.permission(q)},source=chords.length===1?'single':chords.length===2?'two':'three';
   function add(cs,correct){const key=JSON.stringify([meta,cs.map(id)]),s=buckets.get(key)||{...meta,chords:cs,n:0,c:0,sources:{}};s.n++;s.c+=Number(correct);const v=s.sources[source]||{n:0,c:0};v.n++;v.c+=Number(correct);s.sources[source]=v;buckets.set(key,s);}
   chords.forEach((c,i)=>add([c],ok[i]));for(let i=0;i<chords.length-1;i++)add(chords.slice(i,i+2),ok[i]&&ok[i+1]);
  }
  function estimate(chords,q,userId,p){
   const target={key:MusicTheory.recordKey(q),instrument:q.instrument},direct={n:0,c:0},related={n:0,c:0},axes=Object.fromEntries(families.map(f=>[f,{n:0,c:0}])),sources=[];
   for(const s of buckets.values()){
    if(s.userId!==userId||s.permission!==ReferencePolicy.permission(q)||s.chords.length!==chords.length)continue;
    const matches=chords.map((c,i)=>relation(c,s.chords[i],target,s,p));let match=matches.reduce((a,b)=>a.weight<=b.weight?a:b);
    if(matches.every(m=>m.family==='direct')){direct.n+=s.n;direct.c+=s.c;continue;}
    if(chords.length===2){
     // Preserve order and actual root direction, rather than arbitrary sequence similarity.
     if(Math.sign(chords[1].rootMidi-chords[0].rootMidi)!==Math.sign(s.chords[1].rootMidi-s.chords[0].rootMidi))continue;
     match={...match,weight:match.weight*p.pairScale};
    }
    if(!match.weight)continue;
    related.n+=match.weight*s.n;related.c+=match.weight*s.c;const weights=Object.fromEntries(families.map(f=>[f,Math.min(...matches.map(m=>m.family==='direct'?1:(m.weights?.[f]??(m.family===f?m.weight:0))))*(chords.length===2?p.pairScale:1)]));for(const f of families){axes[f].n+=weights[f]*s.n;axes[f].c+=weights[f]*s.c;}
    sources.push({key:s.key,instrument:s.instrument,chords:s.chords.map(id),family:match.family,weight:match.weight,relationshipWeights:weights,n:s.n,c:s.c,sources:s.sources});
   }
   const effectiveCount=Math.min(p.cap,related.n),relatedRate=(related.c+1)/(related.n+2),directRate=(direct.c+2)/(direct.n+4),influence=effectiveCount/(direct.n+4+effectiveCount),combinedRate=(direct.c+2+effectiveCount*relatedRate)/(direct.n+4+effectiveCount);
   return{direct,related,axes,effectiveCount,relatedRate,directRate,influence,combinedRate,sources:sources.sort((a,b)=>b.weight*b.n-a.weight*a.n).slice(0,6)};
  }
  function query(q,userId,p=profiles[0]){
   const chords=q.progression?.chords||[{rootMidi:q.rootMidi,quality:q.quality}],evidence=[];
   const norm=n=>Math.min(1,Math.log1p(n)/Math.log(1001));
   function values(cs,kind,position){if(!cs.length)return fields.map(()=>0);const e=estimate(cs,q,userId,p);evidence.push({kind,position,chords:cs.map(id),...e});return[e.directRate,norm(e.direct.n),.5+(e.relatedRate-.5)*e.influence,e.effectiveCount/6*4/(e.direct.n+4),e.influence,e.combinedRate,...families.flatMap(f=>[.5+((e.axes[f].c+1)/(e.axes[f].n+2)-.5)*e.influence,norm(e.axes[f].n)*e.influence])];}
   const x=[...Array.from({length:3},(_,i)=>values(chords[i]?[chords[i]]:[],'code',i+1)).flat(),...Array.from({length:2},(_,i)=>values(chords[i+1]?chords.slice(i,i+2):[],'pair',i+1)).flat()];return{x,evidence};
  }
  return{observe,query};
 }
 return{version,families,profiles,directProfile,features,createState,overlap,relation};
})();
