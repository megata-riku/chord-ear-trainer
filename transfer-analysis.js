'use strict';
// Reconstruct partial-answer evidence without treating whole-sequence choices as local labels.
const EarTransfer=(()=>{
  const version='component-transfer-v2';
  const codeFields=['rate','count','single_rate','single_count','two_rate','two_count','three_rate','three_count','context_rate','context_count'];
  const pairFields=['rate','count','two_rate','two_count','three_rate','three_count','context_rate','context_count','motion_rate','motion_count','scale_delta','root_delta','bass_delta','scale_up_step','scale_down_step','scale_leap','bass_up','bass_down'];
  const features=[...Array.from({length:3},(_,i)=>codeFields.map(f=>'shared_code_'+(i+1)+'_'+f)).flat(),...Array.from({length:2},(_,i)=>pairFields.map(f=>'shared_pair_'+(i+1)+'_'+f)).flat()];
  const keyOf=c=>c.rootMidi+':'+c.quality;
  const scope=q=>JSON.stringify([q.userId||'',q.instrument,ReferencePolicy.permission(q)]);
  const count=n=>Math.min(1,Math.log1p(n)/Math.log(1001));
  const empty=()=>({n:0,c:0,sources:{}});
  const rate=(s,prior=.5)=>((s?.c||0)+4*prior)/((s?.n||0)+4);
  const degree=(c,key)=>key?.scale.find(n=>n.rootMidi===c.rootMidi)?.degree||0;
  const format=q=>q.task==='chord_progression'?(q.progression.length===2?'two':'three'):'single';
  const context=(q,pos)=>JSON.stringify([MusicTheory.recordKey(q),q.task||'chord_quality',q.progression?.length||1,q.progression?.inputMode||q.options.length,pos,q.duration,q.octave??null,q.guitarStyle||null,q.referenceBeforeQuestion===true,q.selectionPolicy==='history_review']);
  function movement(a,b,key){const da=degree(a,key),db=degree(b,key),scale=db-da,root=b.rootMidi-a.rootMidi,bass=Math.min(...b.notes)-Math.min(...a.notes);return{scale,root,bass,key:'scale:'+scale,known:!!da&&!!db};}
  function createState(){
    const codes=new Map(),pairs=new Map(),motions=new Map(),contexts=new Map(),confusions=new Map(),totals=new Map(),seen=new Set();
    const coverage={singleAnswers:0,orderedAnswers:0,skippedFourChoice:0,skippedUnknownSequence:0,skippedQuality:0};
    function add(map,id,ok,source,meta){const s=map.get(id)||{...empty(),...meta};s.keys=[...new Set([...(s.keys||[]),meta.key])];s.n++;s.c+=Number(ok);const part=s.sources[source]||{n:0,c:0};part.n++;part.c+=Number(ok);s.sources[source]=part;map.set(id,s);return s;}
    function target(q){return q.progression?.chords||[{rootMidi:q.rootMidi,quality:q.quality,notes:q.notes}];}
    function observe(r){
      if(seen.has(r.id))return;seen.add(r.id);const q=r.q;
      if(q.task==='chord_progression'&&q.progression.inputMode==='four'){coverage.skippedFourChoice++;return;}
      if(q.task!=='chord_identity'&&q.task!=='chord_progression'){coverage.skippedQuality++;return;}
      const chords=target(q),answer=r.answer;
      if(q.task==='chord_progression'&&answer==null){coverage.skippedUnknownSequence++;return;}
      let selected;
      if(answer==null)selected=[];else{
        if(typeof answer!=='string')return;
        selected=answer.split('|').map(k=>{const [root,quality]=k.split(':');return{rootMidi:Number(root),quality};});
        if(selected.length!==chords.length||selected.some(c=>!Number.isFinite(c.rootMidi)||!MusicTheory.qualityIds.includes(c.quality)))return;
      }
      const ok=chords.map((c,i)=>!!selected[i]&&keyOf(c)===keyOf(selected[i]));
      // Legacy root-only labels are not accepted as partial evidence.
      const userId=r.userId||'',sc=scope({...q,userId}),source=format(q),keyId=MusicTheory.recordKey(q),key=keyId?MusicTheory.getKey(keyId):null;
      const meta={userId,key:keyId,instrument:q.instrument,referencePermission:ReferencePolicy.permission(q)};
      if(source==='single')coverage.singleAnswers++;else coverage.orderedAnswers++;
      chords.forEach((c,i)=>{
        const id=sc+'|code|'+keyOf(c),info={...meta,chord:keyOf(c),label:MusicTheory.chordName(c.rootMidi,c.quality,keyId)};
        add(codes,id,ok[i],source,info);add(totals,sc+'|code',ok[i],source,meta);add(contexts,id+'|'+context(q,i),ok[i],source,{...info,kind:'code',position:i+1,length:chords.length,inputMode:q.progression?.inputMode||'single',optionCount:q.options.length,manualReview:q.selectionPolicy==='history_review',duration:q.duration,octave:q.octave??null,guitarStyle:q.guitarStyle||null,reference:q.referenceBeforeQuestion===true});
        if(selected[i]&&!ok[i])add(confusions,id+'|'+keyOf(selected[i]),false,source,{...info,answer:keyOf(selected[i]),answerLabel:MusicTheory.chordName(selected[i].rootMidi,selected[i].quality,keyId)});
      });
      for(let i=0;i<chords.length-1;i++){
        const a=chords[i],b=chords[i+1],both=ok[i]&&ok[i+1],id=sc+'|pair|'+keyOf(a)+'>'+keyOf(b),m=movement(a,b,key);
        add(pairs,id,both,source,{...meta,from:keyOf(a),to:keyOf(b),label:MusicTheory.chordName(a.rootMidi,a.quality,keyId)+' → '+MusicTheory.chordName(b.rootMidi,b.quality,keyId)});
        add(totals,sc+'|pair',both,source,meta);add(contexts,id+'|'+context(q,i),both,source,{...meta,kind:'pair',label:MusicTheory.chordName(a.rootMidi,a.quality,keyId)+' → '+MusicTheory.chordName(b.rootMidi,b.quality,keyId),position:i+1,length:chords.length,inputMode:q.progression.inputMode,optionCount:q.options.length,manualReview:q.selectionPolicy==='history_review',duration:q.duration,octave:q.octave??null,guitarStyle:q.guitarStyle||null,reference:q.referenceBeforeQuestion===true});
        if(m.known)add(motions,sc+'|'+keyId+'|motion|'+m.key,both,source,{...meta,scaleDelta:m.scale,label:'音階上の差 '+(m.scale>0?'+':'')+m.scale});
      }
    }
    function query(q,userId=''){
      const sc=scope({...q,userId}),chords=target(q),keyId=MusicTheory.recordKey(q),key=keyId?MusicTheory.getKey(keyId):null;
      const priorCode=rate(totals.get(sc+'|code')),priorPair=rate(totals.get(sc+'|pair'));
      const codeValues=Array.from({length:3},(_,i)=>{
        const chord=chords[i];if(!chord)return codeFields.map(()=>0);
        const id=sc+'|code|'+keyOf(chord),s=codes.get(id),parent=rate(s,priorCode),local=contexts.get(id+'|'+context(q,i));
        return[parent,count(s?.n||0),...['single','two','three'].flatMap(source=>[rate(s?.sources[source],parent),count(s?.sources[source]?.n||0)]),rate(local,parent),count(local?.n||0)];
      }).flat();
      const pairValues=Array.from({length:2},(_,i)=>{
        if(!chords[i+1])return pairFields.map(()=>0);
        const a=chords[i],b=chords[i+1],id=sc+'|pair|'+keyOf(a)+'>'+keyOf(b),s=pairs.get(id),parent=rate(s,priorPair),local=contexts.get(id+'|'+context(q,i)),m=movement(a,b,key),shape=motions.get(sc+'|'+keyId+'|motion|'+m.key);
        return[parent,count(s?.n||0),...['two','three'].flatMap(source=>[rate(s?.sources[source],parent),count(s?.sources[source]?.n||0)]),rate(local,parent),count(local?.n||0),rate(shape,priorPair),count(shape?.n||0),m.scale/6,m.root/12,m.bass/48,Number(m.known&&m.scale===1),Number(m.known&&m.scale===-1),Number(m.known&&Math.abs(m.scale)>1),Number(m.bass>0),Number(m.bass<0)];
      }).flat();
      return[...codeValues,...pairValues];
    }
    function snapshot(){
      const summarize=(map,kind)=>[...map.values()].map(s=>({...s,accuracy:s.n?s.c/s.n:null,smoothed:rate(s,rate(totals.get(scope({task:'chord_identity',key:s.key,instrument:s.instrument,userId:s.userId,referenceAllowed:s.referencePermission==='on'?true:s.referencePermission==='off'?false:undefined})+'|'+kind)))})).sort((a,b)=>b.n-a.n||a.label.localeCompare(b.label));
      return{version,coverage:{...coverage},codes:summarize(codes,'code'),pairs:summarize(pairs,'pair'),motions:summarize(motions,'pair'),contexts:[...contexts.values()].map(s=>({...s,accuracy:s.c/s.n})),confusions:[...confusions.values()].sort((a,b)=>b.n-a.n||a.label.localeCompare(b.label)),evidenceRule:'single_identity_and_explicit_ordered_answers_only',pairOutcome:'both_adjacent_positions_correct',scope:'absolute_chords_user_instrument_reference_permission; motion_and_context_keep_key',contextRule:'length_input_position_duration_register_style_reference_review',note:'Descriptive full-history snapshot; model features only use answers submitted before the question.'};
    }
    return{observe,query,snapshot};
  }
  return{version,features,createState,movement};
})();
