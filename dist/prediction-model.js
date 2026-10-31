'use strict';
const EarPrediction = (() => {
  const version='correctness-logistic-v7',featureVersion='pre-question-confusion-pooling-v7';
  const limits={total:100,sessions:5,train:60,test:20,trainPerClass:5};
  const instruments=['piano','guitar','electric','soft','clear','sine'];
  const qualities=['major','minor','seven','majseven','diminished'];
  const baseFeatures=['prior_global_rate','prior_condition_rate','prior_global_count','prior_condition_count','prior_condition_last_correct','days_since_condition',
    'option_count','duration','note_count','mean_midi','reference_before_question','identity_task','manual_review',
    ...instruments.map(s=>'instrument_'+s),...qualities.map(s=>'quality_'+s),...Array.from({length:12},(_,i)=>'root_pc_'+i),'key_major','key_natural_minor',...Array.from({length:12},(_,i)=>'tonic_pc_'+i),...Array.from({length:7},(_,i)=>'scale_degree_'+(i+1)),
    'progression_task','sequence_length','ordered_input','sequence_gap','candidate_balanced','candidate_random','prior_format_rate','prior_format_count','unique_chords',
    ...Array.from({length:3},(_,pos)=>[...qualities.map(q=>'position_'+(pos+1)+'_quality_'+q),...Array.from({length:12},(_,pc)=>'position_'+(pos+1)+'_pc_'+pc),...Array.from({length:7},(_,d)=>'position_'+(pos+1)+'_degree_'+(d+1))]).flat()];
  baseFeatures.push('candidate_quality_grouped','candidate_two_pattern_groups','reference_permission_on','reference_permission_off','reference_permission_unknown');
  const features=[...baseFeatures,...EarTransfer.features,...EarPooling.features,...EarConfusion.features],directFeatures=[...features];
  const metadata=names=>({featureVersion:names.length===baseFeatures.length?'pre-question-reference-base-v6':featureVersion,features:[...names]});
  const modelLabels={global:'全体の正答率',condition:'同じ条件の正答率'};
  for(const [key,label] of [['logistic','回帰'],['tree','決定木'],['boosted','ブースティング']]){modelLabels['base_'+key]=label+'（直接履歴）';modelLabels[key]=label+'（固定共有）';modelLabels['auto_'+key]=label+'（自動共有）';modelLabels['no_confusion_'+key]=label+'（取り違え情報なし）';}
  const modelKeys=Object.keys(modelLabels);
  function formatKey(q){return q.task==='chord_progression'?'progression_'+q.progression.length+'_'+q.progression.inputMode:q.task||'chord_quality';}
  function formatLabel(key){const m=/^progression_([23])_(four|ordered)$/.exec(key);return m?m[1]+'コード進行・'+(m[2]==='four'?'4択':'順番入力'):key==='chord_identity'?'調の中でコードを当てる':'コードの種類を当てる';}
  const clamp=p=>Math.max(1e-6,Math.min(1-1e-6,p));
  const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
  function conditionKey(q){return JSON.stringify([q.task||'chord_quality',MusicTheory.recordKey(q),q.rootMidi,q.quality,q.instrument,q.duration,q.octave??0,q.guitarStyle||null,q.referenceBeforeQuestion===true,[...q.notes], [...q.options].sort(),ReferencePolicy.permission(q),q.progression?[q.progression.length,q.progression.inputMode,q.progression.gap,q.progression.candidateMode||null,q.progression.candidateGrouping||null,q.progression.chords.map(c=>[c.rootMidi,c.quality,c.notes,c.start,c.duration])]:null]);}
  function prepare(records,config={}){
    const seen=new Set(),eligible=[],excluded={duplicate:0,invalid:0,missingTime:0,unsupported:0};
    for(const a of records){
      if(config.userId&&a?.userId!==config.userId)continue;
      if(config.task&&config.task!=='all'&&(a?.question?.task||'chord_quality')!==config.task)continue;
      if(config.key&&config.key!=='all'&&MusicTheory.recordKey(a?.question||{})!==config.key)continue;
      const q=a?.question;
      if(config.reference&&config.reference!=='all'&&ReferencePolicy.permission(q)!==config.reference)continue;
      if(!ReferencePolicy.validRecord(a)){excluded.invalid++;continue;}
      if(q?.task&&!['chord_quality','chord_identity','chord_progression'].includes(q.task)){excluded.unsupported++;continue;}
      if(q?.task==='chord_progression'&&!Progression.validRecord(a)){excluded.invalid++;continue;}
      if(config.format&&config.format!=='all'&&q&&formatKey(q)!==config.format)continue;
      if(!a||!q||typeof a.id!=='string'||typeof a.sessionId!=='string'||typeof a.userId!=='string'||typeof a.correct!=='boolean'||!instruments.includes(q.instrument)||!qualities.includes(q.quality)||!Number.isFinite(q.rootMidi)||!Array.isArray(q.notes)||!q.notes.length||q.notes.some(n=>!Number.isFinite(n))||!Array.isArray(q.options)||q.options.length<2||!Number.isFinite(q.duration)){excluded.invalid++;continue;}
      if(seen.has(a.id)){excluded.duplicate++;continue;}seen.add(a.id);
      if(['chord_identity','chord_progression'].includes(q.task)&&q.key&&!MusicTheory.validKey(q.key)){excluded.invalid++;continue;}
      const time=Date.parse(q.createdAt||a.firstPlaybackAt),answered=Date.parse(a.answeredAt);
      if(!Number.isFinite(time)||!Number.isFinite(answered)||time>answered){excluded.missingTime++;continue;}
      eligible.push({id:a.id,userId:a.userId,sessionId:a.sessionId,time,answered,y:Number(a.correct),key:conditionKey(q),q,
        answer:a.answer,referencePermission:ReferencePolicy.permission(q),referenceUsage:ReferencePolicy.usage(a),policy:q.selectionPolicy||'legacy',task:q.task||'chord_quality',format:formatKey(q),manual:q.selectionPolicy==='history_review'});
    }
    eligible.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
    const groups=new Map();
    for(const r of eligible){const g=groups.get(r.sessionId)||{id:r.sessionId,start:r.time,end:r.answered,count:0};g.start=Math.min(g.start,r.time);g.end=Math.max(g.end,r.answered);g.count++;groups.set(r.sessionId,g);}
    // Pick a session boundary near 80% using timestamps/counts only, never labels or scores.
    const byStart=[...groups.values()].sort((a,b)=>a.start-b.start),byEnd=[...groups.values()].sort((a,b)=>a.end-b.end);
    const boundaries=[...new Set(byStart.map(g=>g.start))];let best=null,startIndex=0,endIndex=0,startedCount=0,endedCount=0;
    for(const cutoff of boundaries){
      while(startIndex<byStart.length&&byStart[startIndex].start<cutoff)startedCount+=byStart[startIndex++].count;
      while(endIndex<byEnd.length&&byEnd[endIndex].end<cutoff)endedCount+=byEnd[endIndex++].count;
      const trainCount=endedCount,testCount=eligible.length-startedCount;
      if(trainCount<limits.train||testCount<limits.test)continue;
      const score=Math.abs(trainCount/(trainCount+testCount)-.8)+(eligible.length-trainCount-testCount)/eligible.length;
      if(!best||score<best.score)best={score,cutoff,trainSessions:endIndex,testSessions:groups.size-startIndex,trainCount,testCount};
    }
    if(best){
      const trainGroups=new Set(byEnd.filter(g=>g.end<best.cutoff).map(g=>g.id)),testGroups=new Set(byStart.filter(g=>g.start>=best.cutoff).map(g=>g.id));
      best.trainIds=new Set(eligible.filter(r=>trainGroups.has(r.sessionId)).map(r=>r.id));best.testIds=new Set(eligible.filter(r=>testGroups.has(r.sessionId)).map(r=>r.id));
    }
    const needs=[];
    if(!config.userId&&new Set(eligible.map(r=>r.userId)).size>1)needs.push('比較する利用者を1人選んでください');
    if(eligible.length<limits.total)needs.push(`有効な回答をあと${limits.total-eligible.length}件（最初の実験の目安は100件）`);
    if(groups.size<limits.sessions)needs.push(`練習回をあと${limits.sessions-groups.size}回（目安は5回以上）`);
    if(!best)needs.push('時間順に、学習60件以上・評価20件以上へ分けられる練習履歴');
    if(best){const positives=eligible.filter(r=>best.trainIds.has(r.id)&&r.y).length;
      if(positives<limits.trainPerClass||best.trainCount-positives<limits.trainPerClass)needs.push('学習側に正解・不正解がそれぞれ5件以上ある履歴');}
    return{eligible,split:best,summary:{eligible:eligible.length,sessions:groups.size,excluded,limits:{...limits},needs,
      trainCount:best?.trainCount||0,testCount:best?.testCount||0,trainSessions:best?.trainSessions||0,testSessions:best?.testSessions||0,
      boundaryExcluded:best?eligible.length-best.trainCount-best.testCount:0}};
  }
  // Reveal a label only if its answer was already submitted before this question began.
  // Test history may update these pre-question features; model weights remain frozen.
  function buildRows(eligible,context=eligible,profile=EarPooling.profiles[0]){
    const events=[...eligible].sort((a,b)=>a.answered-b.answered||a.id.localeCompare(b.id));
    const stats=new Map(),formatStats=new Map(),shared=EarTransfer.createState(),pooling=EarPooling.createState(),confusions=EarConfusion.createState(),sharedEvents=[...context].sort((a,b)=>a.answered-b.answered||a.id.localeCompare(b.id));let n=0,c=0,eventIndex=0,sharedIndex=0;
    return eligible.map(r=>{
      while(sharedIndex<sharedEvents.length&&sharedEvents[sharedIndex].answered<r.time){const e=sharedEvents[sharedIndex++];shared.observe(e);pooling.observe(e);confusions.observe(e);}
      while(eventIndex<events.length&&events[eventIndex].answered<r.time){
        const e=events[eventIndex++],s=stats.get(e.key)||{n:0,c:0,last:null,lastCorrect:0};
        n++;c+=e.y;s.n++;s.c+=e.y;s.last=e.answered;s.lastCorrect=e.y?1:-1;stats.set(e.key,s);const f=formatStats.get(e.format||formatKey(e.q))||{n:0,c:0};f.n++;f.c+=e.y;formatStats.set(e.format||formatKey(e.q),f);
      }
      const keyId=MusicTheory.recordKey(r.q),keyInfo=keyId?MusicTheory.getKey(keyId):null;
      const degree=keyInfo?.scale.find(n=>n.rootMidi===r.q.rootMidi)?.degree||0;
      const s=stats.get(r.key)||{n:0,c:0,last:null,lastCorrect:0},global=(c+1)/(n+2),condition=(s.c+4*global)/(s.n+4),q=r.q;
      const f=formatStats.get(r.format||formatKey(q))||{n:0,c:0},sequence=q.progression?.chords||[],formatRate=(f.c+4*global)/(f.n+4);
      const x=[global,condition,Math.min(1,Math.log1p(n)/Math.log(10001)),Math.min(1,Math.log1p(s.n)/Math.log(1001)),s.lastCorrect,
        s.last===null?1:Math.min(1,Math.log1p((r.time-s.last)/86400000)/Math.log(31)),
        q.options.length/7,q.duration/3,q.notes.length/6,q.notes.reduce((a,b)=>a+b,0)/q.notes.length/94,Number(q.referenceBeforeQuestion===true),Number(r.task==='chord_identity'),Number(r.manual),
        ...instruments.map(i=>Number(q.instrument===i)),...qualities.map(i=>Number(q.quality===i)),...Array.from({length:12},(_,i)=>Number(q.rootMidi%12===i)),Number(keyInfo?.mode==='major'),Number(keyInfo?.mode==='natural_minor'),
        ...Array.from({length:12},(_,i)=>Number(keyInfo!==null&&keyInfo.tonic%12===i)),...Array.from({length:7},(_,i)=>Number(degree===i+1)),
        Number(r.task==='chord_progression'),sequence.length/3,Number(q.progression?.inputMode==='ordered'),(q.progression?.gap||0),Number(q.progression?.candidateMode==='balanced'),Number(q.progression?.candidateMode==='random'),formatRate,Math.min(1,Math.log1p(f.n)/Math.log(1001)),new Set(sequence.map(c=>c.rootMidi+':'+c.quality)).size/3,
        ...Array.from({length:3},(_,pos)=>{const c=sequence[pos],d=c&&keyInfo?.scale.find(n=>n.rootMidi===c.rootMidi)?.degree;return[...qualities.map(quality=>Number(c?.quality===quality)),...Array.from({length:12},(_,pc)=>Number(!!c&&c.rootMidi%12===pc)),...Array.from({length:7},(_,i)=>Number(d===i+1))];}).flat()];
      x.push(Number(q.progression?.candidateGrouping==='quality-grouped-v1'),Number(q.progression?.candidateGrouping==='quality-grouped-v1'&&new Set(q.options.map(o=>Progression.qualityPattern(Progression.decode(o)))).size===2));
      x.push(...['on','off','unknown'].map(p=>Number(ReferencePolicy.permission(q)===p)));
      const baseX=[...x];x.push(...shared.query(q,r.userId));const confusion=confusions.query(q,r.userId),directX=[...x,...pooling.query(q,r.userId,EarPooling.directProfile).x,...confusion.x],pooled=pooling.query(q,r.userId,profile);x.push(...pooled.x,...confusion.x);
      return{id:r.id,sessionId:r.sessionId,userId:r.userId,predictedAt:new Date(r.time).toISOString(),answeredAt:Number.isFinite(r.answered)?new Date(r.answered).toISOString():null,y:r.y,x,baseX,directX,poolingEvidence:pooled.evidence,confusionEvidence:confusion.evidence,global,condition,priorCount:n,priorConditionCount:s.n,task:r.task,policy:r.policy,keyId,referencePermission:r.referencePermission||ReferencePolicy.permission(q),referenceUsage:r.referenceUsage||'unknown',format:r.format||formatKey(q),candidateMode:q.progression?.candidateMode||null,candidateGrouping:q.progression?.candidateGrouping||'legacy'};
    });
  }
  function fit(rows,settings={iterations:600,learningRate:.4,l2:.05},names=features){
    const weights=names.map(()=>0),p=(rows.reduce((s,r)=>s+r.y,0)+1)/(rows.length+2);let intercept=Math.log(p/(1-p));
    for(let step=0;step<settings.iterations;step++){
      const gradient=weights.map(()=>0);let biasGradient=0;
      for(const row of rows){let z=intercept;for(let j=0;j<weights.length;j++)z+=weights[j]*row.x[j];const error=sigmoid(z)-row.y;biasGradient+=error;for(let j=0;j<weights.length;j++)gradient[j]+=error*row.x[j];}
      intercept-=settings.learningRate*biasGradient/rows.length;
      for(let j=0;j<weights.length;j++)weights[j]-=settings.learningRate*(gradient[j]/rows.length+settings.l2*weights[j]);
    }
    return{version:names.length===features.length?version:'correctness-logistic-direct-v6',...metadata(names),weights,intercept,settings:{...settings}};
  }
  function predict(model,x){return clamp(sigmoid(model.intercept+model.weights.reduce((s,w,j)=>s+w*x[j],0)));}
  function metrics(rows,key){let brier=0,logLoss=0;
    for(const r of rows){const p=clamp(r[key]);brier+=(p-r.y)**2;logLoss-=r.y*Math.log(p)+(1-r.y)*Math.log(1-p);}
    return{count:rows.length,brier:rows.length?brier/rows.length:null,logLoss:rows.length?logLoss/rows.length:null};
  }
  function calibration(rows,key='logistic'){return Array.from({length:5},(_,i)=>{const bin=rows.filter(r=>Math.min(4,Math.floor(r[key]*5))===i);return{lower:i/5,upper:(i+1)/5,count:bin.length,meanPrediction:bin.length?bin.reduce((s,r)=>s+r[key],0)/bin.length:null,accuracy:bin.length?bin.reduce((s,r)=>s+r.y,0)/bin.length:null};});}
  // A smoothed, shallow CART classifier. Every split/threshold uses training rows only.
  function fitTree(rows,settings={maxDepth:3,minLeaf:8,priorStrength:4},names=features){
    const prior=(rows.reduce((sum,r)=>sum+r.y,0)+1)/(rows.length+2);
    function grow(data,depth){
      const positive=data.reduce((sum,r)=>sum+r.y,0),node={probability:(positive+settings.priorStrength*prior)/(data.length+settings.priorStrength),count:data.length};
      if(depth>=settings.maxDepth||data.length<2*settings.minLeaf||positive===0||positive===data.length)return node;
      let best=null;
      for(let feature=0;feature<names.length;feature++){
        const sorted=[...data].sort((a,b)=>a.x[feature]-b.x[feature]);let leftPositive=0;
        for(let i=1;i<sorted.length;i++){
          leftPositive+=sorted[i-1].y;
          if(i<settings.minLeaf||data.length-i<settings.minLeaf||sorted[i-1].x[feature]===sorted[i].x[feature])continue;
          const gain=leftPositive**2/i+(positive-leftPositive)**2/(data.length-i)-positive**2/data.length;
          if(gain>1e-10&&(!best||gain>best.gain))best={feature,threshold:(sorted[i-1].x[feature]+sorted[i].x[feature])/2,gain};
        }
      }
      if(!best)return node;
      return{...node,...best,left:grow(data.filter(r=>r.x[best.feature]<=best.threshold),depth+1),right:grow(data.filter(r=>r.x[best.feature]>best.threshold),depth+1)};
    }
    return{version:names.length===features.length?'correctness-cart-pooling-v7':'correctness-cart-direct-v7',...metadata(names),settings:{...settings},root:grow(rows,0)};
  }
  function predictTree(model,x){let node=model.root;while(node.left)node=x[node.feature]<=node.threshold?node.left:node.right;return clamp(node.probability);}
  // Logistic-loss gradient boosting with Newton leaf values and depth-one trees.
  function fitBoosted(rows,settings={rounds:40,learningRate:.1,minLeaf:8,l2:1,maxLeafValue:2},names=features){
    const prior=(rows.reduce((sum,r)=>sum+r.y,0)+1)/(rows.length+2),intercept=Math.log(prior/(1-prior)),scores=rows.map(()=>intercept),stumps=[];
    const sorted=names.map((_,feature)=>rows.map((r,i)=>i).sort((a,b)=>rows[a].x[feature]-rows[b].x[feature]));
    const bounded=value=>Math.max(-settings.maxLeafValue,Math.min(settings.maxLeafValue,value));
    for(let round=0;round<settings.rounds;round++){
      const probabilities=scores.map(sigmoid),grad=rows.map((r,i)=>r.y-probabilities[i]),hess=probabilities.map(p=>p*(1-p));
      const G=grad.reduce((a,b)=>a+b,0),H=hess.reduce((a,b)=>a+b,0);let best=null;
      for(let feature=0;feature<names.length;feature++){
        let gl=0,hl=0;const order=sorted[feature];
        for(let i=1;i<rows.length;i++){
          gl+=grad[order[i-1]];hl+=hess[order[i-1]];
          if(i<settings.minLeaf||rows.length-i<settings.minLeaf||rows[order[i-1]].x[feature]===rows[order[i]].x[feature])continue;
          const gain=gl*gl/(hl+settings.l2)+(G-gl)**2/(H-hl+settings.l2)-G*G/(H+settings.l2);
          if(gain>1e-10&&(!best||gain>best.gain))best={feature,threshold:(rows[order[i-1]].x[feature]+rows[order[i]].x[feature])/2,left:bounded(gl/(hl+settings.l2)),right:bounded((G-gl)/(H-hl+settings.l2)),gain};
        }
      }
      if(!best)break;stumps.push(best);
      rows.forEach((r,i)=>{scores[i]+=settings.learningRate*(r.x[best.feature]<=best.threshold?best.left:best.right);});
    }
    return{version:names.length===features.length?'correctness-logit-boosted-pooling-v7':'correctness-logit-boosted-direct-v7',...metadata(names),settings:{...settings},intercept,stumps};
  }
  function predictBoosted(model,x){return clamp(sigmoid(model.intercept+model.settings.learningRate*model.stumps.reduce((score,s)=>score+(x[s.feature]<=s.threshold?s.left:s.right),0)));}
  function analyze(records,config={}){const context=prepare(records,{userId:config.userId,key:config.key,reference:config.reference,task:'all'}).eligible,state=EarTransfer.createState();for(const r of context)state.observe(r);return state.snapshot();}
  function run(records,config={}){
    const prepared=prepare(records,config),{summary,split,eligible}=prepared;
    if(summary.needs.length)return{status:'insufficient',summary};
    const context=prepare(records,{userId:config.userId,key:config.key,task:'all'}).eligible;
    const fixed=EarPooling.profiles[0],rows=buildRows(eligible,context,fixed),train=rows.filter(r=>split.trainIds.has(r.id)),test=rows.filter(r=>split.testIds.has(r.id));
    const families={logistic:[fit,predict],tree:[fitTree,predictTree],boosted:[fitBoosted,predictBoosted]},models={},evaluated=test.map(r=>({...r}));
    const outerTrainingRecords=records.filter(r=>split.trainIds.has(r.id)),inner=prepare(outerTrainingRecords,config);
    const innerTrain=inner.split?rows.filter(r=>inner.split.trainIds.has(r.id)):[],innerValidation=inner.split?rows.filter(r=>inner.split.testIds.has(r.id)):[];
    const reasons=[...inner.summary.needs];
    if(innerValidation.filter(r=>r.y).length<5||innerValidation.filter(r=>!r.y).length<5)reasons.push('内側の検証に正解・不正解がそれぞれ5件以上必要');
    const evidenceCount=data=>data.filter(r=>r.poolingEvidence.some(e=>e.effectiveCount>0)).length;
    if(evidenceCount(innerTrain)<20||evidenceCount(innerValidation)<10)reasons.push('関連履歴のある問題が内側の学習20件・検証10件に満たない');
    const rowCache=new Map([[fixed.id,rows]]),profileRows=p=>{if(!rowCache.has(p.id))rowCache.set(p.id,buildRows(eligible,context,p));return rowCache.get(p.id);};
    const selection={status:reasons.length?'deferred':'selected',reasons,innerCutoff:inner.split?new Date(inner.split.cutoff).toISOString():null,trainIds:innerTrain.map(r=>r.id),validationIds:innerValidation.map(r=>r.id),profiles:EarPooling.profiles,byModel:{}};
    const relationAblations=[];
    for(const [family,[fitModel,predictModel]] of Object.entries(families)){
      const directRows=train.map(r=>({...r,x:r.directX})),base=fitModel(directRows,undefined,directFeatures),fixedModel=fitModel(train,undefined,features);
      models['base_'+family]=base;models[family]=fixedModel;
      let chosen=fixed,candidates=[];
      if(!reasons.length){
        for(const profile of EarPooling.profiles){const data=profileRows(profile),it=data.filter(r=>inner.split.trainIds.has(r.id)),iv=data.filter(r=>inner.split.testIds.has(r.id)),m=fitModel(it,undefined,features),predictions=iv.map(r=>({...r,p:predictModel(m,r.x)}));candidates.push({profile:profile.id,...metrics(predictions,'p')});}
        chosen=EarPooling.profiles.find(p=>p.id===[...candidates].sort((a,b)=>a.brier-b.brier)[0].profile);
      }
      const chosenRows=profileRows(chosen),auto=chosen.id===fixed.id?fixedModel:fitModel(chosenRows.filter(r=>split.trainIds.has(r.id)),undefined,features),byId=new Map(chosenRows.map(r=>[r.id,r]));models['auto_'+family]=auto;
      for(const r of [...train,...evaluated]){if(!r.autoX)r.autoX={};r.autoX[family]=byId.get(r.id).x;}
      selection.byModel[family]={selectedProfile:chosen.id,candidates};
      for(const r of evaluated){r['base_'+family]=predictModel(base,r.directX);r[family]=predictModel(fixedModel,r.x);r['auto_'+family]=predictModel(auto,byId.get(r.id).x);}
    }
    // Refit each relationship in isolation; its comparison is not an inference-time feature removal.
    for(const axis of EarPooling.families){
      const profile={...fixed,id:'only_'+axis,...Object.fromEntries(EarPooling.families.filter(f=>f!==axis).map(f=>[f,0]))},data=profileRows(profile),past=data.filter(r=>split.trainIds.has(r.id)),future=data.filter(r=>split.testIds.has(r.id));
      const result={axis,profile,models:{},metrics:{},predictions:{}};
      for(const [family,[fitModel,predictModel]] of Object.entries(families)){const m=fitModel(past,undefined,features),predictions=future.map(r=>({id:r.id,y:r.y,p:predictModel(m,r.x)}));result.models[family]=m;result.metrics[family]=metrics(predictions,'p');result.predictions[family]=predictions;}
      relationAblations.push(result);
    }
    const confusionComparison=[];
    for(const [family,[fitModel,predictModel]] of Object.entries(families)){
      const mask=x=>x.map((v,i)=>i>=features.length-EarConfusion.features.length?0:v),m=fitModel(train.map(r=>({...r,x:mask(r.x)})),undefined,features),name='no_confusion_'+family;models[name]=m;
      for(const row of evaluated)row[name]=predictModel(m,mask(row.x));
      confusionComparison.push({model:family,without:name,with:family,brierDifference:metrics(evaluated,family).brier-metrics(evaluated,name).brier,logLossDifference:metrics(evaluated,family).logLoss-metrics(evaluated,name).logLoss});
    }
    const model=models.logistic;
    const analysis=EarTransfer.createState();for(const row of [...context].sort((a,b)=>a.answered-b.answered||a.id.localeCompare(b.id)))analysis.observe(row);
    const transferComparison=['logistic','tree','boosted'].map(key=>({model:key,base:'base_'+key,withShared:key,brierDifference:metrics(evaluated,key).brier-metrics(evaluated,'base_'+key).brier,logLossDifference:metrics(evaluated,key).logLoss-metrics(evaluated,'base_'+key).logLoss}));
    const groups=[...new Set(evaluated.map(r=>r.task))].map(task=>({task,models:Object.fromEntries(modelKeys.map(key=>[key,metrics(evaluated.filter(r=>r.task===task),key)]))}));
    const keyGroups=[...new Set(evaluated.map(r=>r.keyId))].map(key=>({key,models:Object.fromEntries(modelKeys.map(name=>[name,metrics(evaluated.filter(r=>r.keyId===key),name)]))}));
    const formatGroups=[...new Set(evaluated.map(r=>r.format))].map(format=>({format,label:formatLabel(format),trainCount:train.filter(r=>r.format===format).length,trainCorrect:train.filter(r=>r.format===format&&r.y).length,models:Object.fromEntries(modelKeys.map(name=>[name,metrics(evaluated.filter(r=>r.format===format),name)]))}));
    const candidateGroups=['balanced','random'].map(candidateMode=>({candidateMode,models:Object.fromEntries(modelKeys.map(name=>[name,metrics(evaluated.filter(r=>r.candidateMode===candidateMode),name)]))})).filter(g=>g.models.logistic.count);
    const coverageGroups=[...new Set([...train,...test].map(r=>r.format+'|'+r.referencePermission))].map(value=>{const [format,referencePermission]=value.split('|'),past=train.filter(r=>r.format===format&&r.referencePermission===referencePermission),future=test.filter(r=>r.format===format&&r.referencePermission===referencePermission);return{format,label:formatLabel(format),referencePermission,trainCount:past.length,trainCorrect:past.reduce((s,r)=>s+r.y,0),trainIncorrect:past.filter(r=>!r.y).length,testCount:future.length,testCorrect:future.reduce((s,r)=>s+r.y,0),unseenInTraining:!past.length&&future.length>0};});
    const referenceUsageGroups=[...new Set(evaluated.map(r=>r.referenceUsage))].map(usage=>({usage,label:ReferencePolicy.usageLabels[usage],models:Object.fromEntries(modelKeys.map(key=>[key,metrics(evaluated.filter(r=>r.referenceUsage===usage),key)]))}));
    const candidateGroupingGroups=[...new Set(evaluated.filter(r=>r.task==='chord_progression').map(r=>r.candidateGrouping))].map(candidateGrouping=>({candidateGrouping,models:Object.fromEntries(modelKeys.map(name=>[name,metrics(evaluated.filter(r=>r.task==='chord_progression'&&r.candidateGrouping===candidateGrouping),name)]))}));
    const policyGroups=[...new Set(evaluated.map(r=>r.policy))].map(policy=>({policy,count:evaluated.filter(r=>r.policy===policy).length}));
    return{status:'ready',format:'ear-lab-prediction-experiment',schemaVersion:5,experimentVersion:'correctness-confusion-pooling-v7',createdAt:new Date().toISOString(),config,summary,
      protocol:{version:'session-forward-online-v1',cutoff:new Date(split.cutoff).toISOString(),split:'past_sessions_then_future_sessions',features:'only_labels_submitted_before_question_creation',testHistory:'previous_test_answers_update_features_only',modelWeights:'frozen_after_training',hyperparameters:'fixed_models_and_training_only_nested_profile_selection',scope:'observed_question_distribution',sharedEvidence:'same_user_permission_with_absolute_chords_across_keys_and_causal_cross_task_context',ablation:'same_targets_split_settings_direct_components_vs_related_pooling; relationship_only_refits'},
      model,models,selection,relationAblations,confusionComparison,pooling:{version:EarPooling.version,fixedProfile:fixed,rule:'max_relationship_once_per_source; bounded_pseudo_count; inverse_direct_history_influence',pitchOverlap:'Jaccard of deduplicated pitch classes',pairRule:'ordered adjacent endpoints with matching actual root direction',scope:'same user and reference permission; guitar-electric only across instruments'},modelLabels:{...modelLabels},baselines:{global:'Laplace (past correct + 1) / (past count + 2)',condition:'(past condition correct + 4 * prior global rate) / (past condition count + 4)'},
      trainingRows:train,evaluationRows:evaluated,metrics:Object.fromEntries(modelKeys.map(key=>[key,metrics(evaluated,key)])),calibration:calibration(evaluated),calibrations:Object.fromEntries(modelKeys.map(key=>[key,calibration(evaluated,key)])),groups,keyGroups,formatGroups,candidateGroups,candidateGroupingGroups,coverageGroups,referenceUsageGroups,policyGroups,transferComparison,sharedAnalysis:analysis.snapshot(),sharedContextCount:context.length};
  }
  return{analyze,prepare,buildRows,fit,predict,metrics,calibration,run,conditionKey,features,baseFeatures,directFeatures,limits,version,featureVersion,formatKey,formatLabel,modelLabels,modelKeys,fitTree,predictTree,fitBoosted,predictBoosted};
})();
