'use strict';
const EarAdaptive=(()=>{
 const version='adaptive-practice-v1',modelLabels={logistic:'回帰',tree:'決定木',boosted:'ブースティング'};
 const clamp=p=>Math.max(0,Math.min(1,p));
 function question(config,item){
  const s=item.solution,quality=typeof s.quality==='number'?MusicTheory.qualityIds[s.quality]:s.quality;
  const notes=c=>['guitar','electric'].includes(config.instrument)?Array.from(GuitarVoicings.notes(c.rootMidi,MusicTheory.qualityIds.indexOf(c.quality))):MusicTheory.intervals[MusicTheory.qualityIds.indexOf(c.quality)].map(n=>n+c.rootMidi+(config.octave||0));
  const q={task:config.task,key:config.key||null,rootMidi:s.rootMidi,quality,notes:notes({rootMidi:s.rootMidi,quality}),instrument:config.instrument,duration:config.duration,octave:config.octave,guitarStyle:config.guitarStyle,options:item.options.map(o=>o.key),referenceAllowed:config.referenceAllowed,referenceBeforeQuestion:false,createdAt:config.historyCutoffAt,selectionPolicy:'adaptive_'+config.strategy};
  if(s.chords){let start=0;const chords=s.chords.map(c=>{const ns=notes(c),value={...c,notes:ns,start,duration:config.duration};start+=config.duration+(config.guitarStyle==='strum'?(ns.length-1)*.028:0)+Progression.gap;return value;});q.progression={version:Progression.version,length:chords.length,inputMode:config.inputMode,gap:Progression.gap,chords,candidateMode:item.candidateMode,candidateGrouping:item.candidateGrouping||null};}
  return q;
 }
 function candidatePool(config,random=Math.random){
  if(config.task==='chord_progression'){
   const pool=Progression.sequencePool(config.length,config.key);
   if(config.inputMode==='ordered')return pool.map(chords=>({solution:{...PracticeModel.identityOptions('diatonic',config.key).find(o=>o.rootMidi===chords[0].rootMidi),key:Progression.keyOf(chords),chords},options:PracticeModel.identityOptions('diatonic',config.key),candidateMode:null}));
   // Score candidate sets; sample their audible answer uniformly only after choosing a set.
   return PracticeModel.shuffled(pool,random).slice(0,Math.min(60,pool.length)).map((anchor,i)=>{const mode=i%2?'random':'balanced',options=Progression.candidateSet(anchor,mode,config.key,random,pool);return{solution:{...PracticeModel.identityOptions('diatonic',config.key).find(o=>o.rootMidi===anchor[0].rootMidi),key:Progression.keyOf(anchor),chords:anchor},options,candidateMode:mode,candidateGrouping:Progression.candidateVersion};});
  }
  return PracticeModel.trainingDomain(config).map(solution=>({solution,options:config.task==='chord_identity'?PracticeModel.identityAnswerOptions(config.preset,config.key,solution,random):PracticeModel.modes[config.mode].map(i=>PracticeModel.option(solution.rootMidi,i,'chord_quality')),candidateMode:null}));
 }
 function prepare(config,records,pool){
  const cutoff=Date.parse(config.historyCutoffAt),past=EarPrediction.prepare(records,{userId:config.userId,task:'all'}).eligible.filter(r=>r.answered<cutoff);
  const local=past.filter(r=>r.q.instrument===config.instrument&&ReferencePolicy.permission(r.q)===ReferencePolicy.permission(question(config,pool[0]))),rows=EarPrediction.buildRows(past,past);
  const global=(local.reduce((s,r)=>s+r.y,0)+2)/(local.length+4),stats=new Map();
  for(const r of local){const q=r.q,id=targetKey(q),s=stats.get(id)||{n:0,c:0,last:[]};s.n++;s.c+=r.y;s.last.push(r.y);s.last=s.last.slice(-5);stats.set(id,s);}
  const variants=[],ranges=[];
  pool.forEach(item=>{const start=variants.length,items=config.task==='chord_progression'&&config.inputMode==='four'?item.options.map(o=>({...item,solution:{...PracticeModel.identityOptions('diatonic',config.key).find(c=>c.rootMidi===o.chords[0].rootMidi),key:o.key,chords:o.chords}})):[item];variants.push(...items.map(i=>question(config,i)));ranges.push([start,variants.length]);});
  const entries=variants.map((q,i)=>({id:'candidate:'+i,userId:config.userId,sessionId:'candidate',time:cutoff,answered:Infinity,y:0,key:EarPrediction.conditionKey(q),q,task:q.task,format:EarPrediction.formatKey(q),policy:q.selectionPolicy,manual:false}));
  const candidates=EarPrediction.buildRows([...past,...entries],past).slice(past.length);
  return{past,rows,local,global,stats,variants,ranges,candidates};
 }
 function targetKey(q){return JSON.stringify([q.task,MusicTheory.recordKey(q),q.progression?.length||1,q.progression?.inputMode||q.options.length,q.rootMidi,q.quality,q.progression?Progression.keyOf(q.progression.chords):null,q.duration,q.octave??null,q.guitarStyle||null,q.progression?.candidateGrouping||null]);}
 function ruleEvidence(q,row,state){
  const direct=state.stats.get(targetKey(q))||{n:0,c:0,last:[]},rate=(direct.c+4*state.global)/(direct.n+4),recent=direct.last.length?1-direct.last.reduce((a,b)=>a+b,0)/direct.last.length:0;
  const components=(row.poolingEvidence||[]).filter(e=>e.direct.n||e.effectiveCount),weak=components.length?components.reduce((n,e)=>n+1-e.combinedRate,0)/components.length:1-rate;
  const conf=(row.confusionEvidence||[]).filter(e=>e.sum>0).sort((a,b)=>b.rate-a.rate)[0];
  const score=clamp(.45*(1-rate)+.3*weak+.15*recent+.1*(conf?.rate||0)),n=direct.n+components.reduce((n,e)=>n+e.direct.n+e.effectiveCount,0);
  const pair=components.filter(e=>e.kind==='pair').sort((a,b)=>a.combinedRate-b.combinedRate)[0],code=components.filter(e=>e.kind==='code').sort((a,b)=>a.combinedRate-b.combinedRate)[0];
  const reason=conf?'confusion':pair&&1-pair.combinedRate>=weak?'pair':code?'code':direct.n?'recent':'unseen';
  return{score,n,reason,directAttempts:direct.n,directCorrect:direct.c,rate,recent,confusion:conf?{target:conf.target,answer:conf.max.answer,count:conf.max.count,n:conf.n}:null,component:reason==='pair'?{chords:pair.chords,n:pair.direct.n,rate:pair.combinedRate}:code?{chords:code.chords,n:code.direct.n,rate:code.combinedRate}:null};
 }
 function scorePool(config,records,pool){
  const state=prepare(config,records,pool),fits={logistic:[EarPrediction.fit,EarPrediction.predict],tree:[EarPrediction.fitTree,EarPrediction.predictTree],boosted:[EarPrediction.fitBoosted,EarPrediction.predictBoosted]},family=config.model||'logistic',reasons=[];
  if(state.past.length<60)reasons.push('学習に使える回答が60件未満');
  if(state.past.filter(r=>r.y).length<5||state.past.filter(r=>!r.y).length<5)reasons.push('学習側の正解・不正解がそれぞれ5件未満');
  const format=EarPrediction.formatKey(state.variants[0]);if(state.local.filter(r=>r.format===format).length<10)reasons.push('同じ楽器・試聴許可・問題形式の履歴が10件未満');
  let model=null,fallback=null;
  if(config.strategy==='model'&&!reasons.length){try{model=fits[family][0](state.rows);}catch(error){fallback='モデルの学習に失敗したため';}}
  const effective=config.strategy==='model'&&model?'model':'rule';
  if(config.strategy==='model'&&!model)fallback=fallback||reasons.join(' ／ ');
  const variantScores=state.candidates.map((row,i)=>{const evidence=ruleEvidence(state.variants[i],row,state);return{evidence,prediction:model?fits[family][1](model,row.x):null,predictionFeatures:model?row.x:null};});
  const scored=pool.map((item,i)=>{const [a,b]=state.ranges[i],scores=variantScores.slice(a,b),ruleScore=scores.reduce((s,x)=>s+x.evidence.score,0)/scores.length,p=scores.every(s=>s.prediction!==null)?scores.reduce((n,s)=>n+s.prediction,0)/scores.length:null;return{item,variants:scores,ruleScore,score:effective==='model'?1-p:ruleScore,evidenceCount:scores.reduce((n,s)=>n+s.evidence.n,0)/scores.length};});
  return{scored,effective,fallback,model,trainingCount:state.past.length,historyIds:state.past.map(r=>r.id),scope:format};
 }
 function createPlan(config,records,random=null){
  const seed=config.seed??(random?0:Math.floor(Math.random()*4294967296));let stateSeed=seed>>>0;if(!random)random=()=>{stateSeed=(Math.imul(stateSeed,1664525)+1013904223)>>>0;return stateSeed/4294967296;};
  const pool=candidatePool(config,random),state=scorePool(config,records,pool),hasEvidence=state.scored.some(s=>s.evidenceCount>0),uses=new Map(),chordUses=new Map(),items=[],schedule=PracticeModel.shuffled(Array.from({length:10},(_,i)=>i<5&&hasEvidence?'weak':'normal'),random);
  const identity=item=>config.inputMode==='four'&&config.task==='chord_progression'?item.options.map(o=>o.key).sort().join(';'):item.solution.key;
  const codes=item=>item.solution.chords?item.solution.chords.map(Progression.chordKey):[item.solution.rootMidi+':'+MusicTheory.qualityIds[item.solution.quality]];
  for(const bucket of schedule){
   const counts=s=>{const count=uses.get(identity(s.item))||0,exposure=codes(s.item).reduce((n,c)=>n+(chordUses.get(c)||0),0)/codes(s.item).length;return{count,exposure};};
   let allowed=state.scored.filter(s=>!items.length||identity(s.item)!==identity(items.at(-1)));
   // Never more than two identical targets; tiny two-code domains still remain usable.
   if(config.task==='chord_progression'&&config.inputMode==='four'&&items.length){const different=allowed.filter(s=>s.item.options.every(o=>o.key!==items.at(-1).solution.key));if(different.length)allowed=different;}
   if(!allowed.length)allowed=state.scored;
   if(bucket==='weak'&&allowed.some(s=>s.evidenceCount>0))allowed=allowed.filter(s=>s.evidenceCount>0);
   if(bucket==='normal'){const least=Math.min(...allowed.map(s=>counts(s).count));allowed=allowed.filter(s=>counts(s).count===least);}else{const belowCap=allowed.filter(s=>counts(s).count<3);if(belowCap.length)allowed=belowCap;}
   if(bucket==='weak'&&allowed.some(s=>s.evidenceCount>0))allowed=allowed.filter(s=>s.evidenceCount>0);
   const ranked=PracticeModel.shuffled(allowed,random).sort((a,b)=>bucket==='weak'?(b.score-.06*counts(b).count-.035*counts(b).exposure)-(a.score-.06*counts(a).count-.035*counts(a).exposure):counts(a).exposure-counts(b).exposure);
   const selected=ranked[0],index=config.task==='chord_progression'&&config.inputMode==='four'?Math.floor(random()*4):0,item=selected.item,choice=config.task==='chord_progression'&&config.inputMode==='four'?item.options[index]:null;
   const solution=choice?{...PracticeModel.identityOptions('diatonic',config.key).find(c=>c.rootMidi===choice.chords[0].rootMidi),key:choice.key,chords:choice.chords}:item.solution,e=selected.variants[index];
   const selection={policyVersion:version,seed,bucket,requested:config.strategy,effective:state.effective,fallbackReason:state.fallback,reason:bucket==='normal'?'coverage':e.evidence.reason,historyCutoffAt:config.historyCutoffAt,priorAttempts:e.evidence.directAttempts,priorCorrect:e.evidence.directCorrect,evidence:e.evidence,score:selected.score,predictedProbability:e.prediction,predictionFeatures:e.predictionFeatures,setMeanProbability:selected.variants.every(v=>v.prediction!==null)?selected.variants.reduce((n,v)=>n+v.prediction,0)/selected.variants.length:null,modelFamily:config.model||'logistic',modelVersion:state.model?.version||null,featureVersion:state.model?.featureVersion||null,poolingProfile:'balanced',modelSnapshotId:config.sessionId||null,trainingCount:state.trainingCount,planPosition:items.length+1,candidateCount:pool.length,candidateSelection:choice?'set_mean_then_uniform_target':'target_priority',targetProbabilityWithinSet:choice?.key? .25:null};
   const planned={...item,solution,selection};items.push(planned);uses.set(identity(item),(uses.get(identity(item))||0)+1);for(const c of codes(planned))chordUses.set(c,(chordUses.get(c)||0)+1);
  }
  return{policyVersion:version,seed,historyCutoffAt:config.historyCutoffAt,weakCount:hasEvidence?5:0,normalCount:hasEvidence?5:10,requested:config.strategy,effective:state.effective,fallbackReason:state.fallback,model:state.model,modelFamily:config.model||'logistic',trainingCount:state.trainingCount,trainingIds:state.historyIds,items};
 }
 function explanation(selection){
  const s=selection;if(!s||s.policyVersion!==version)return'';
  const label=value=>value.split('|').map(k=>{const [root,quality]=k.split(':');return MusicTheory.chordName(Number(root),quality);}).join(' → '),mode=s.effective==='model'?'モデル式（'+modelLabels[s.modelFamily]+'）':'ルール式';
  let text=s.bucket==='normal'?'範囲全体の練習：出題の偏りを抑えるため':s.candidateSelection==='set_mean_then_uniform_target'?'重点練習：苦手度の高い候補の組を選び、その中から正解を25%で決定':s.reason==='confusion'&&s.evidence.confusion?label(s.evidence.confusion.target)+'を'+label(s.evidence.confusion.answer)+'と取り違えた履歴があるため':s.reason==='pair'&&s.evidence.component?'隣接ペア '+s.evidence.component.chords.map(label).join(' → ')+'の成績を参考にしたため':s.reason==='code'&&s.evidence.component?'コード '+s.evidence.component.chords.map(label).join('・')+'の成績を参考にしたため':s.priorAttempts?'この問題の過去'+s.priorAttempts+'回中'+s.priorCorrect+'回正解の成績を参考にしたため':'履歴が少ない範囲も練習するため';
  text+=' · '+mode;if(s.predictedProbability!==null)text+=' · 練習開始時の予測正答率 '+Math.round(s.predictedProbability*100)+'%';if(s.fallbackReason)text+='（モデル式は保留：'+s.fallbackReason+'）';return text;
 }
 function validSelection(s){return !!s&&s.policyVersion===version&&['rule','model'].includes(s.requested)&&['rule','model'].includes(s.effective)&&['weak','normal'].includes(s.bucket)&&['coverage','confusion','pair','code','recent','unseen'].includes(s.reason)&&Number.isFinite(Date.parse(s.historyCutoffAt))&&Number.isInteger(s.planPosition)&&s.planPosition>=1&&s.planPosition<=10&&Number.isInteger(s.priorAttempts)&&s.priorAttempts>=0&&Number.isInteger(s.priorCorrect)&&s.priorCorrect>=0&&s.priorCorrect<=s.priorAttempts&&Number.isFinite(s.score)&&s.score>=0&&s.score<=1&&(s.predictedProbability===null||Number.isFinite(s.predictedProbability)&&s.predictedProbability>=0&&s.predictedProbability<=1)&&!!s.evidence&&(s.predictionFeatures==null||Array.isArray(s.predictionFeatures)&&s.predictionFeatures.length<=1000&&s.predictionFeatures.every(Number.isFinite))&&Object.hasOwn(modelLabels,s.modelFamily)&&Number.isInteger(s.trainingCount)&&s.trainingCount>=0;}
 function validSnapshots(items){
  if(!Array.isArray(items)||items.length>10000)return false;
  const seen=new Set();return items.every(s=>{if(!s||typeof s.id!=='string'||!s.id.startsWith('adaptive:model:')||seen.has(s.id))return false;seen.add(s.id);const v=s.value,m=v?.model;if(!m||!Object.hasOwn(modelLabels,v.modelFamily)||!Number.isFinite(Date.parse(v.trainedAt))||!Array.isArray(v.trainingIds)||v.trainingIds.length>10000||v.trainingIds.some(id=>typeof id!=='string'||id.length>100)||!Array.isArray(m.features)||m.features.length>1000)return false;let count=0;function node(n){return ++count<10000&&!!n&&Number.isFinite(n.probability)&&(!n.left||Number.isInteger(n.feature)&&n.feature>=0&&n.feature<m.features.length&&Number.isFinite(n.threshold)&&node(n.left)&&node(n.right));}if(v.modelFamily==='tree')return node(m.root);if(v.modelFamily==='logistic')return Number.isFinite(m.intercept)&&Array.isArray(m.weights)&&m.weights.length===m.features.length&&m.weights.every(Number.isFinite);return Number.isFinite(m.intercept)&&Number.isFinite(m.settings?.learningRate)&&Array.isArray(m.stumps)&&m.stumps.length<=1000&&m.stumps.every(s=>Number.isInteger(s.feature)&&s.feature>=0&&s.feature<m.features.length&&[s.threshold,s.left,s.right].every(Number.isFinite));});
 }
 return{validSnapshots,version,question,candidatePool,scorePool,createPlan,explanation,validSelection};
})();
