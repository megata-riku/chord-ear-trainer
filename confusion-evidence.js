'use strict';
// Directed mistakes are observed answers, not inferred labels from sequence choices.
const EarConfusion=(()=>{
 const version='directed-confusion-v1',fields=['observed_count','offered_wrong_rate','offered_wrong_count','max_wrong_rate','max_wrong_count','position_wrong_rate','context_wrong_rate','context_count'];
 const features=[...Array.from({length:3},(_,i)=>fields.map(f=>'confusion_'+(i+1)+'_'+f)).flat(),'sequence_confusion_count','sequence_offered_wrong_rate','sequence_offered_wrong_count','sequence_max_wrong_rate'];
 const key=c=>c.rootMidi+':'+c.quality,norm=n=>Math.min(1,Math.log1p(n)/Math.log(1001));
 const scope=(q,user)=>JSON.stringify([user,q.instrument,ReferencePolicy.permission(q),q.task==='chord_quality'?'quality':'identity']);
 const context=(q,i)=>JSON.stringify([MusicTheory.recordKey(q),q.progression?.length||1,q.progression?.inputMode||'single',i,q.duration,q.octave??null,q.guitarStyle||null]);
 function createState(){
  const codes=new Map(),positions=new Map(),contexts=new Map(),sequences=new Map(),seen=new Set();
  function add(map,id,selected,correct,meta){const s=map.get(id)||{n:0,wrong:{},ids:[],...meta};s.n++;s.ids.push(meta?.id);if(selected&&selected!==correct)s.wrong[selected]=(s.wrong[selected]||0)+1;map.set(id,s);}
  function observe(r){
   if(seen.has(r.id))return;seen.add(r.id);const q=r.q,sc=scope(q,r.userId),cs=q.progression?.chords||[{rootMidi:q.rootMidi,quality:q.quality}];
   if(q.progression?.inputMode==='four'){const correct=Progression.keyOf(cs);add(sequences,sc+'|'+correct,r.answer,correct,{id:r.id});return;}
   if(q.progression&&r.answer==null)return;
   let selected=typeof r.answer==='string'?r.answer.split('|'):[];
   if(q.task==='chord_quality')selected=r.answer?[q.rootMidi+':'+r.answer]:[];
   if(r.answer!=null&&(selected.length!==cs.length||selected.some(s=>{const [root,quality]=s.split(':');return !Number.isFinite(Number(root))||!MusicTheory.qualityIds.includes(quality);})))return;
   cs.forEach((c,i)=>{const id=sc+'|'+key(c);add(codes,id,selected[i],key(c),{id:r.id});add(positions,id+'|'+cs.length+'|'+i,selected[i],key(c),{id:r.id});add(contexts,id+'|'+context(q,i),selected[i],key(c),{id:r.id});});
  }
  function offered(q,c){return(q.options||[]).filter(o=>!o.includes('|')).map(o=>o.includes(':')?o:q.rootMidi+':'+o).filter(o=>o!==key(c));}
  function summary(s,choices){const entries=choices.map(k=>({answer:k,count:s?.wrong[k]||0})),sum=entries.reduce((n,e)=>n+e.count,0),max=entries.reduce((best,e)=>e.count>best.count?e:best,{answer:null,count:0});return{n:s?.n||0,sum,max,rate:sum/((s?.n||0)+4),maxRate:max.count/((s?.n||0)+4)};}
  function query(q,user){
   const cs=q.progression?.chords||[{rootMidi:q.rootMidi,quality:q.quality}],sc=scope(q,user),evidence=[];
   const x=Array.from({length:3},(_,i)=>{
    if(!cs[i]||q.progression?.inputMode==='four')return fields.map(()=>0);
    const id=sc+'|'+key(cs[i]),choices=offered(q,cs[i]),s=summary(codes.get(id),choices),p=summary(positions.get(id+'|'+cs.length+'|'+i),choices),c=summary(contexts.get(id+'|'+context(q,i)),choices);
    evidence.push({position:i+1,target:key(cs[i]),...s});return[norm(s.n),s.rate,norm(s.sum),s.maxRate,norm(s.max.count),p.rate,c.rate,norm(c.n)];
   }).flat();
   const s=q.progression?.inputMode==='four'?summary(sequences.get(sc+'|'+Progression.keyOf(cs)),q.options.filter(o=>o!==Progression.keyOf(cs))):{n:0,rate:0,sum:0,maxRate:0};
   return{x:[...x,norm(s.n),s.rate,norm(s.sum),s.maxRate],evidence,sequence:s};
  }
  return{observe,query};
 }
 return{version,features,createState};
})();
