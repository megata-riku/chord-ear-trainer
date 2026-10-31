'use strict';
const PracticeModel = (() => {
  const qualityIds=['major','minor','seven','majseven','diminished'];
  const modes={majorMinor:[0,1],majorSeven:[0,2],sevenMajseven:[2,3],all:[0,1,2,3]};
  function option(rootMidi,quality,task='chord_identity') {
    return {key:task==='chord_identity'?rootMidi+':'+qualityIds[quality]:qualityIds[quality],rootMidi,quality};
  }
  function decodeOption(key,rootMidi,task) {
    if(task==='chord_identity'){
      const [root,id]=key.split(':');return option(Number(root),qualityIds.indexOf(id),task);
    }
    return option(rootMidi,qualityIds.indexOf(key),'chord_quality');
  }
  function shuffled(items,random=Math.random){const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
  function generate(mode,roots,random=Math.random){const choices=modes[mode];if(!choices||!roots.length)throw new Error('練習設定を確認してください。');return{quality:choices[Math.floor(random()*choices.length)],root:roots[Math.floor(random()*roots.length)],options:shuffled(choices,random),selectionProbability:1/(roots.length*choices.length)};}
  function identityOptions(preset,key='C_major'){return MusicTheory.degrees(key,preset).map(o=>option(o.rootMidi,o.quality));}
  function identityAnswerOptions(preset,key,solution,random=Math.random){
    const domain=identityOptions(preset,key);if(preset!=='diatonic4')return domain;
    const selected=new Set([solution.key,...shuffled(domain.filter(o=>o.key!==solution.key),random).slice(0,3).map(o=>o.key)]);
    return domain.filter(o=>selected.has(o.key));
  }
  function generateIdentity(preset,random=Math.random,key='C_major'){
    const domain=identityOptions(preset,key),solution=domain[Math.floor(random()*domain.length)];
    return{solution,options:identityAnswerOptions(preset,key,solution,random),selectionProbability:1/domain.length};
  }
  function buildBalancedIdentityPlan(preset,key,random=Math.random){
    const domain=identityOptions(preset,key),items=[];
    while(items.length<10)for(const solution of shuffled(domain,random)){if(items.length===10)break;items.push({solution,options:identityAnswerOptions(preset,key,solution,random),selection:null});}
    return{policyVersion:'curriculum-v1',weakCount:0,normalCount:10,items:spreadPlan(items,random)};
  }
  function reviewQueue(records,limit=10,random=Math.random){const unique=new Map();for(const a of [...records].reverse()){if(a.correct)continue;const q=a.question;const key=[q.task||'chord_quality',MusicTheory.recordKey(q)||'',q.rootMidi,q.quality,q.instrument,q.notes.join(','),q.guitarStyle||'',q.referenceBeforeQuestion!==false,q.options.slice().sort().join(','),q.progression?Progression.keyOf(q.progression.chords):''].join('|');if(!unique.has(key))unique.set(key,a);}return shuffled([...unique.values()],random).slice(0,limit);}
  const mixedPolicyVersion='mixed-review-v1';
  const targetKey=o=>o.rootMidi+':'+qualityIds[o.quality];
  function trainingDomain(config){
    return config.task==='chord_identity'?identityOptions(config.preset,config.key||'C_major'):config.roots.flatMap(root=>modes[config.mode].map(i=>option(root,i,'chord_quality')));
  }
  function optionsFor(config,solution){
    return config.task==='chord_identity'?identityOptions(config.preset,config.key||'C_major'):modes[config.mode].map(i=>option(solution.rootMidi,i,'chord_quality'));
  }
  function sameContext(record,config,solution){
    const q=record.question,guitar=['guitar','electric'].includes(config.instrument);
    if((q.task||'chord_quality')!==config.task||q.rootMidi!==solution.rootMidi||q.quality!==qualityIds[solution.quality]||q.instrument!==config.instrument||q.duration!==config.duration)return false;
    if(guitar?(q.guitarStyle||'strum')!==config.guitarStyle:(q.octave??0)!==config.octave)return false;
    if(config.task==='chord_identity'&&(MusicTheory.recordKey(q)!==(config.key||'C_major')||(q.referenceBeforeQuestion!==false)!==config.reference))return false;
    if(config.referenceAllowed!==undefined&&ReferencePolicy.applicable(q)&&ReferencePolicy.permission(q)!==(config.referenceAllowed?'on':'off'))return false;
    const expected=optionsFor(config,solution).map(o=>o.key);
    if(config.task==='chord_identity'&&config.preset==='diatonic4')return q.options.length===4&&q.options.includes(solution.key)&&q.options.every(key=>expected.includes(key));
    return q.options.length===expected.length&&expected.every(key=>q.options.includes(key));
  }
  // Reorder a ten-question multiset without changing its coverage or weak/normal quotas.
  function spreadPlan(items,random){
    const grouped=new Map();
    for(const item of shuffled(items,random)){const key=targetKey(item.solution);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(item);}
    const groups=[...grouped.values()],result=[];
    function arrange(last='',run=0){
      if(result.length===items.length)return true;
      const remaining=items.length-result.length;
      for(const group of groups){const n=group.length,key=n?targetKey(group[0].solution):'';if(n>2*(remaining-n+1)-(key===last?run:0))return false;}
      const order=shuffled(groups.filter(g=>g.length),random).sort((a,b)=>b.length-a.length);
      for(const group of order){const key=targetKey(group[0].solution);if(key===last&&run>=2)continue;
        const item=group.pop();result.push(item);
        if(arrange(key,key===last?run+1:1))return true;
        result.pop();group.push(item);
      }
      return false;
    }
    if(!arrange())throw new Error('出題順を準備できませんでした。');
    return result;
  }
  function buildMixedPlan(config,records,random=Math.random){
    const domain=trainingDomain(config),cutoff=config.historyCutoffAt||new Date().toISOString();
    const past=records.filter(a=>Date.parse(a.answeredAt)<=Date.parse(cutoff)).sort((a,b)=>Date.parse(a.answeredAt)-Date.parse(b.answeredAt)||a.id.localeCompare(b.id));
    const candidates=domain.map(solution=>{
      const recent=past.filter(a=>sameContext(a,config,solution)).slice(-5),n=recent.length,correct=recent.filter(a=>a.correct).length;
      return{solution,n,correct,score:(correct+1)/(n+2),ids:recent.map(a=>a.id),lastAnsweredAt:recent.at(-1)?.answeredAt||null};
    });
    const weak=candidates.filter(c=>c.n>0&&c.correct/c.n<.8),items=[],weakUses=new Map(),normalUses=new Map();
    function add(candidate,bucket){
      const key=targetKey(candidate.solution),counts=bucket==='weak'?weakUses:normalUses;counts.set(key,(counts.get(key)||0)+1);
      items.push({solution:candidate.solution,options:config.task==='chord_identity'?identityAnswerOptions(config.preset,config.key||'C_major',candidate.solution,random):optionsFor(config,candidate.solution),selection:{policyVersion:mixedPolicyVersion,bucket,
        reason:bucket==='weak'?'weak_recent':weak.length?'balanced_coverage':'no_weak_history',historyCutoffAt:cutoff,
        priorAttempts:candidate.n,priorCorrect:candidate.correct,priorLastAnsweredAt:candidate.lastAnsweredAt,priorAttemptIds:[...candidate.ids]}});
    }
    if(weak.length)for(let i=0;i<5;i++){
      const ranked=shuffled(weak,random).sort((a,b)=>(weakUses.get(targetKey(a.solution))||0)-(weakUses.get(targetKey(b.solution))||0)||a.score-b.score);
      add(ranked[0],'weak');
    }
    while(items.length<10){
      const ranked=shuffled(candidates,random).sort((a,b)=>(normalUses.get(targetKey(a.solution))||0)-(normalUses.get(targetKey(b.solution))||0)||(weakUses.get(targetKey(a.solution))||0)-(weakUses.get(targetKey(b.solution))||0));
      add(ranked[0],'normal');
    }
    return{policyVersion:mixedPolicyVersion,historyCutoffAt:cutoff,weakCandidateCount:weak.length,weakCount:weak.length?5:0,normalCount:weak.length?5:10,
      items:spreadPlan(items,random).map((item,index)=>({...item,selection:{...item.selection,planPosition:index+1}}))};
  }
  function selectionExplanation(record){
    if(record.question.adaptiveFailure)return '適応出題の計算を開始できなかったため、範囲全体から出題しました。';
    if(record.question.step)return 'ステップ'+record.question.step.stage+'の挑戦：範囲全体から偏りを抑えて出題';
    const s=record.question.selection;
    if(s?.policyVersion==='adaptive-practice-v1')return EarAdaptive.explanation(s);
    if(!s)return record.question.selectionPolicy==='history_review'?'履歴から選んだ問題':'';
    if(s.bucket==='weak')return `苦手の復習：同じ条件の直近${s.priorAttempts}回で${s.priorCorrect}回正解`;
    return s.reason==='no_weak_history'?'範囲全体から出題：この条件では苦手に該当する履歴がないため':'範囲全体から出題：範囲全体の響きも練習するため';
  }
  function validateBackup(data){
    if(data?.format!=='ear-lab-history'||data.schemaVersion!==1||!Array.isArray(data.attempts)||data.attempts.length>10000)throw new Error('コードの聴き取り単語帳の履歴JSON（最大10,000件）を選んでください。');
    const seen=new Set(),roots=Array.from({length:12},(_,i)=>60+i);
    const fail=()=>{throw new Error('履歴データの形式が正しくありません。取り込みは行いませんでした。');};
    for(const a of data.attempts){
      const q=a?.question,identity=q?.task==='chord_identity';
      if(!ReferencePolicy.validRecord(a))fail();
      if(q?.selection?.policyVersion==='adaptive-practice-v1'&&(!EarAdaptive.validSelection(q.selection)||q.step||Date.parse(q.selection.historyCutoffAt)>Date.parse(q.createdAt)))fail();
      if(q?.task==='chord_progression'){
        if(!a||typeof a.id!=='string'||a.id.length>100||seen.has(a.id)||typeof a.sessionId!=='string'||a.sessionId.length>100||typeof a.userId!=='string'||a.userId.length>100||a.schemaVersion!==1||!Number.isFinite(Date.parse(a.answeredAt))||!['piano','guitar','electric','soft','clear','sine'].includes(q.instrument)||!Number.isInteger(a.playbackCount)||a.playbackCount<1||!Number.isFinite(a.responseTimeMs)||a.responseTimeMs<0||!Number.isFinite(q.duration)||q.duration<=0||q.duration>3||!Progression.validRecord(a))fail();
        if(q.referenceBeforeQuestion!==undefined&&typeof q.referenceBeforeQuestion!=='boolean')fail();
        if(q.octave!==undefined&&q.octave!==null&&![-12,0,12].includes(q.octave))fail();
        if(q.guitarStyle!==undefined&&q.guitarStyle!==null&&!['strum','together'].includes(q.guitarStyle))fail();
        seen.add(a.id);continue;
      }
      if(!a||typeof a.id!=='string'||a.id.length>100||seen.has(a.id)||typeof a.sessionId!=='string'||a.sessionId.length>100||typeof a.userId!=='string'||a.userId.length>100||!Number.isFinite(Date.parse(a.answeredAt))||a.schemaVersion!==1||!q||!qualityIds.includes(q.quality)||!['piano','guitar','electric','soft','clear','sine'].includes(q.instrument)||!roots.includes(q.rootMidi)||!Array.isArray(q.notes)||q.notes.length<3||q.notes.length>6||q.notes.some(n=>!Number.isInteger(n)||n<40||n>94)||!Array.isArray(q.options)||q.options.length<2||q.options.length>(identity?7:5)||new Set(q.options).size!==q.options.length||!Number.isInteger(a.playbackCount)||a.playbackCount<1||!Number.isFinite(a.responseTimeMs)||a.responseTimeMs<0||!Number.isFinite(q.duration)||q.duration<=0||q.duration>3)fail();
      if(q.task&& !['chord_quality','chord_identity'].includes(q.task))fail();
      const samePitches=(notes,root,quality)=>{
        const actual=[...new Set(notes.map(n=>n%12))].sort((a,b)=>a-b),expected=MusicTheory.intervals[qualityIds.indexOf(quality)].map(n=>(root+n)%12).sort((a,b)=>a-b);
        return actual.length===expected.length&&actual.every((n,i)=>n===expected[i]);
      };
      if(!samePitches(q.notes,q.rootMidi,q.quality))fail();
      if(identity&&q.key!==undefined&&q.key!==null&&!MusicTheory.validKey(q.key))fail();
      if(identity&&q.key){
        const allowed=identityOptions('diatonic',q.key).map(o=>o.key);
        if(!allowed.includes(q.rootMidi+':'+q.quality)||q.options.some(key=>!allowed.includes(key)))fail();
      }
      if(q.referenceNotes!==undefined&&q.referenceNotes!==null&&(!Array.isArray(q.referenceNotes)||q.referenceNotes.length<3||q.referenceNotes.length>6||q.referenceNotes.some(n=>!Number.isInteger(n)||n<40||n>94)))fail();
      for(const key of q.options){if(typeof key!=='string')fail();if(identity){const parts=key.split(':');if(parts.length!==2||!roots.includes(Number(parts[0]))||!qualityIds.includes(parts[1]))fail();}else if(!qualityIds.includes(key))fail();}
      const correctKey=identity?q.rootMidi+':'+q.quality:q.quality;
      if(!q.options.includes(correctKey)||(a.answer!==null&&!q.options.includes(a.answer))||a.correct!==(a.answer===correctKey))fail();
      if(identity&&q.referenceNotes){
        const key=MusicTheory.getKey(q.key||'C_major');if(!samePitches(q.referenceNotes,key.tonic,key.mode==='natural_minor'?'minor':'major'))fail();
      }
      if(q.step!==undefined&&q.step!==null){
        const stage=q.step.stage,preset={1:'cfg',2:'diatonic4',3:'diatonic'}[stage];
        if(!identity||q.step.version!=='curriculum-v1'||!preset||q.step.preset!==preset||q.selectionPolicy!=='curriculum'||a.sourceAttemptId||!q.key)fail();
        const domain=identityOptions(preset,q.key).map(o=>o.key),count=stage===1?3:stage===2?4:7;
        if(q.options.length!==count||q.options.some(o=>!domain.includes(o)))fail();
      }
      if(q.referenceBeforeQuestion!==undefined&&typeof q.referenceBeforeQuestion!=='boolean')fail();
      if(q.octave!==undefined&&q.octave!==null&&![-12,0,12].includes(q.octave))fail();
      if(q.guitarStyle!==undefined&&q.guitarStyle!==null&&!['strum','together'].includes(q.guitarStyle))fail();
      if(q.selection!==undefined&&q.selection!==null&&q.selection.policyVersion!=='adaptive-practice-v1'){
        const selection=q.selection;
        if(selection.policyVersion!==mixedPolicyVersion||!['weak','normal'].includes(selection.bucket)||!['weak_recent','balanced_coverage','no_weak_history'].includes(selection.reason)||!Number.isFinite(Date.parse(selection.historyCutoffAt))||!Number.isInteger(selection.priorAttempts)||selection.priorAttempts<0||selection.priorAttempts>5||!Number.isInteger(selection.priorCorrect)||selection.priorCorrect<0||selection.priorCorrect>selection.priorAttempts||!Array.isArray(selection.priorAttemptIds)||selection.priorAttemptIds.length!==selection.priorAttempts||selection.priorAttemptIds.some(id=>typeof id!=='string'||id.length>100)||!Number.isInteger(selection.planPosition)||selection.planPosition<1||selection.planPosition>10)fail();
        if(selection.priorLastAnsweredAt!==null&&!Number.isFinite(Date.parse(selection.priorLastAnsweredAt)))fail();
        if(selection.bucket==='weak'&&(selection.reason!=='weak_recent'||!selection.priorAttempts||selection.priorCorrect/selection.priorAttempts>=.8))fail();
        if(selection.bucket==='normal'&&selection.reason==='weak_recent')fail();
      }
      seen.add(a.id);
    }
    if(data.adaptiveModels!==undefined&&!EarAdaptive.validSnapshots(data.adaptiveModels))fail();
    if(data.sessions!==undefined){
      if(!Array.isArray(data.sessions)||data.sessions.length>10000)fail();
      const sessionIds=new Set();
      for(const s of data.sessions){
        if(!s||typeof s.id!=='string'||!s.id||s.id.length>100||sessionIds.has(s.id)||!Number.isFinite(Date.parse(s.startedAt))||!Number.isFinite(Date.parse(s.updatedAt))||!['in_progress','interrupted','completed'].includes(s.status)||!Number.isInteger(s.total)||s.total<1||s.total>10000||!Number.isInteger(s.answered)||s.answered<0||s.answered>s.total||!Number.isInteger(s.correct)||s.correct<0||s.correct>s.answered)fail();
        if(s.referenceAllowed!==undefined&&s.referenceAllowed!==null&&typeof s.referenceAllowed!=='boolean')fail();
        if(s.key!==undefined&&s.key!==null&&!MusicTheory.validKey(s.key))fail();
        sessionIds.add(s.id);
      }
    }
    return data.attempts;
  }
  return{buildBalancedIdentityPlan,identityAnswerOptions,buildMixedPlan,trainingDomain,selectionExplanation,generate,generateIdentity,identityOptions,option,decodeOption,reviewQueue,shuffled,validateBackup,qualityIds,modes};
})();
