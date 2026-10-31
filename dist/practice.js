'use strict';
(() => {
  const store = new EarHistoryStore();
  let attempts = [], sessions = [], adaptiveSnapshots = [], userId = earUUID(), storageReady = false,historyLoaded=false;
  let nextStepTarget=null,referenceChanged=false;
  let view = 'practice', session = null, question = null, sequence = 0;
  const feedbackClock = new FeedbackClock();
  let behavior = FeedbackFlow.normalize(), behaviorChanged=false;
  const initial = {sound:null};
  const qualityIndex = id => types.findIndex(t => t.id === id);
  const qualityLabel = id => types[qualityIndex(id)]?.label || '分からない';
  const chordName = (rootMidi,quality,key=null) => MusicTheory.chordName(rootMidi,qualityIndex(quality),key);
  const recordKey=record=>MusicTheory.recordKey(record.question);
  const recordChord=record=>record.question.progression?Progression.label(record.question.progression.chords,recordKey(record)):chordName(record.question.rootMidi,record.question.quality,recordKey(record));
  const recordKeyLabel=record=>recordKey(record)?MusicTheory.getKey(recordKey(record)).label:'コードの種類';
  const notice = text => { $('storageNotice').textContent = text; };
  const predictionPanel=new PredictionPanel({store,notice});
  const init = (async () => {
    try {
      await store.open();
      userId = await store.userId();
      attempts = await store.list();
      sessions = await store.sessions();
      adaptiveSnapshots=await store.adaptiveModels();
      storageReady = true;
      const savedBehavior=await store.preference();
      if(!behaviorChanged)behavior=FeedbackFlow.normalize(savedBehavior);
      paintBehavior();
      const savedReference=await store.referencePreference();if(!referenceChanged&&typeof savedReference==='boolean')$('allowReference').checked=savedReference;
      notice('回答履歴はこのブラウザに保存されます。サイトデータの削除に備え、時々JSONでバックアップしてね。');
    } catch (error) {
      notice('このブラウザでは履歴を保存できません。今回の回答はページを閉じる前に「履歴を見る」からJSONで保存してください。');
    }finally{historyLoaded=true;paintSteps();}
  })();
  function lockSettings(locked) {
    document.querySelectorAll('[data-instrument]').forEach(b => b.disabled = locked);
    for (const id of ['root','duration','synthTone','guitarStyle','allowReference']) $(id).disabled = locked;
    $('octave').disabled = locked || isGuitar();
    document.querySelectorAll('[data-view]').forEach(b => b.disabled = locked && b.dataset.view !== 'practice');
  }
  function updatePanels() {
    const active = !!session;
    $('practicePanel').hidden = view !== 'practice';
    $('historyPanel').hidden = view !== 'history';
    $('predictionPanel').hidden = view !== 'prediction';
    $('instrumentSection').hidden = view === 'history'||view === 'prediction';
    $('soundSettings').hidden = view === 'history'||view === 'prediction';
    $('timbreHint').hidden = view === 'history'||view === 'prediction';
    $('labChordHeading').hidden = view !== 'lab';
    $('chords').hidden = view !== 'lab';
    $('answerWorkspace').hidden = !(view === 'lab' || (view === 'practice' && active && question?.answered && question?.reviewing));
    document.querySelectorAll('[data-view]').forEach(b => {
      const selected=b.dataset.view===view;
      b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));
    });
    $('root').closest('label').hidden=view==='practice'&&(active?['chord_identity','chord_progression'].includes(question?.task):($('practiceTrack').value==='steps'||$('practiceTask').value!=='quality'));
    lockSettings(active);
  }
  function setView(next) {
    if (session && next !== 'practice') return;
    stop(true);view=next;if(next==='lab'){setActiveKey(null);render();}updatePanels();
    if (view === 'history') {init.then(renderHistory);status('練習の履歴を表示しています。');}
    else if(view==='prediction'){init.then(()=>predictionPanel.open(attempts,userId,storageReady));status('回答履歴から正答確率の予測を比較します。');}
    else status(view === 'lab' ? '楽器やコードを選んで、自由に聴いてみよう。' : '楽器と練習内容を選んで始めよう。');
  }
  const rootPool = () => $('practiceRoots').value === 'chromatic' ? Array.from({length:12},(_,i)=>60+i) : $('practiceRoots').value === 'all' ? [60,62,64,65,67,69,71] : $('practiceRoots').value === 'current' ? [Number($('root').value)] : [60,65,67];
  function soundSettings() {return{root:$('root').value,octave:$('octave').value,instrument:$('timbre').value,duration:$('duration').value,guitarStyle:$('guitarStyle').value};}
  function applySound(config) {
    setActiveKey(MusicTheory.recordKey(config));
    $('root').value=String(config.rootMidi??config.root??65);
    $('octave').value=String(config.octave??0);
    $('timbre').value=config.instrument;
    if(['soft','clear','sine'].includes(config.instrument))$('synthTone').value=config.instrument;
    const duration=String(config.duration);
    if(!Array.from($('duration').options).some(o=>o.value===duration)){const option=document.createElement('option');option.value=duration;option.textContent=duration+'秒（履歴）';$('duration').append(option);}
    $('duration').value=duration;
    $('guitarStyle').value=config.guitarStyle||'strum';
    updateTimbreHint();
  }
  function saveSession(state='in_progress') {
    if(!session)return;
    const value={id:session.id,startedAt:session.startedAt,updatedAt:new Date().toISOString(),status:state,total:session.total,
      answered:session.answers.length,correct:session.answers.filter(a=>a.correct).length,
      task:session.task||'history_review',mode:session.mode,preset:session.preset||null,key:session.key||null,step:session.step||null,instrument:$('timbre').value,selectionStrategy:session.selectionStrategy||'history_review',
      referenceAllowed:session.referenceAllowed??null,selectionPlan:session.plan?{policyVersion:session.plan.policyVersion,historyCutoffAt:session.plan.historyCutoffAt,weakCandidateCount:session.plan.weakCandidateCount,weakCount:session.plan.weakCount,normalCount:session.plan.normalCount}:null};
    const index=sessions.findIndex(s=>s.id===value.id);
    if(index<0)sessions.push(value);else sessions[index]=value;
    if(storageReady)store.saveSession(value).catch(()=>notice('練習の記録を保存できませんでした。「履歴を見る」からJSONで保存してください。'));
  }
  function sessionPanels(){session.referenceAllowed=$('allowReference').checked;saveSession();view='practice';$('practiceSetup').hidden=true;$('practiceResults').hidden=true;$('practiceQuestion').hidden=false;newQuestion();}
  async function adaptivePlan(){
    const requested=session.selectionStrategy==='model'?'model':'rule';
    const config={userId,sessionId:session.id,task:session.task,key:session.key,preset:session.preset,mode:session.mode,roots:session.roots,length:session.length,inputMode:session.inputMode,strategy:requested,model:$('adaptiveModel').value,instrument:$('timbre').value,duration:Number($('duration').value),octave:isGuitar()?null:Number($('octave').value),guitarStyle:isGuitar()?$('guitarStyle').value:null,referenceAllowed:$('allowReference').checked,historyCutoffAt:session.startedAt,seed:Math.floor(Math.random()*4294967296)};
    const records=attempts.filter(a=>a.userId===userId&&Date.parse(a.answeredAt)<Date.parse(session.startedAt));
    $('startPractice').disabled=true;lockSettings(true);$('adaptiveSetupStatus').textContent='出題を準備しています…';
    let worker,timer;
    try{
      const plan=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('出題の計算に時間がかかったため中断しました。')),30000);worker=new Worker('adaptive-worker.js?v=26');worker.onmessage=e=>e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);worker.onerror=()=>reject(new Error('適応出題の計算を開始できませんでした。'));worker.postMessage({records,config});});
      if(plan.model){const snapshot={model:plan.model,modelFamily:plan.modelFamily,trainingIds:plan.trainingIds,trainedAt:session.startedAt,config};adaptiveSnapshots.push({id:'adaptive:model:'+session.id,value:snapshot});if(storageReady)await store.saveAdaptiveModel(session.id,snapshot).catch(()=>notice('モデルの記録を保存できませんでした。今回の練習は続けられます。'));}
      delete plan.model;delete plan.trainingIds;
      $('adaptiveSetupStatus').textContent=plan.fallbackReason?'モデル式は保留し、ルール式で出題します：'+plan.fallbackReason:'';
      return plan;
    }catch(error){
      $('adaptiveSetupStatus').textContent=error.message+' 範囲全体からの出題に切り替えます。';
      session.adaptiveFailure=error.message;session.selectionStrategy='uniform';return session.task==='chord_progression'?Progression.createPlan(session.length,session.inputMode,session.key):session.task==='chord_identity'?PracticeModel.buildBalancedIdentityPlan(session.preset,session.key):null;
    }finally{clearTimeout(timer);worker?.terminate();$('startPractice').disabled=false;lockSettings(false);}
  }
  async function start(stage=null) {
    if(session||$('startPractice').disabled)return;
    $('startPractice').disabled=true;await init;$('startPractice').disabled=false;
    initial.sound=soundSettings();
    if(stage!==null){
      const level=Curriculum.progress(attempts,{key:$('practiceKey').value,instrument:$('timbre').value}).find(s=>s.id===stage);
      if(!level?.unlocked){status('前のステップを9 / 10以上でクリアすると挑戦できます。');return;}
      session={id:earUUID(),startedAt:new Date().toISOString(),mode:'curriculum',roots:[],answers:[],total:10,task:stage<=3?'chord_identity':'chord_progression',preset:level.preset,key:$('practiceKey').value,
        reference:false,reviewQueue:null,selectionStrategy:'curriculum',step:{version:Curriculum.version,stage,preset:level.preset}};
      session.roots=PracticeModel.identityOptions(stage<=3?level.preset:'diatonic',session.key).map(o=>o.rootMidi);session.plan=Curriculum.createPlan(stage,session.key);sessionPanels();return;
    }
    if($('practiceTask').value.startsWith('progression')){
      session={id:earUUID(),startedAt:new Date().toISOString(),mode:'progression',roots:[],answers:[],total:10,task:'chord_progression',key:$('practiceKey').value,reference:false,selectionStrategy:$('selectionStrategy').value,length:$('practiceTask').value==='progression2'?2:3,inputMode:$('progressionInput').value};
      session.roots=PracticeModel.identityOptions('diatonic',session.key).map(o=>o.rootMidi);
      session.plan=session.selectionStrategy==='uniform'?Progression.createPlan(session.length,session.inputMode,session.key):await adaptivePlan();sessionPanels();return;
    }
    session={id:earUUID(),startedAt:new Date().toISOString(),mode:$('practiceMode').value,roots:rootPool(),answers:[],total:10,
      task:$('practiceTask').value==='tonal'?'chord_identity':'chord_quality',preset:$('identityChoices').value,key:$('practiceTask').value==='tonal'?$('practiceKey').value:null,reference:false,reviewQueue:null,selectionStrategy:$('selectionStrategy').value};
    if(session.task==='chord_identity')session.roots=PracticeModel.identityOptions(session.preset,session.key).map(o=>o.rootMidi);
    if(['mixed','model'].includes(session.selectionStrategy))session.plan=await adaptivePlan();
    sessionPanels();
  }
  async function startReview(records) {
    if(session||!records.length)return;
    await init;initial.sound=soundSettings();
    session={id:earUUID(),startedAt:new Date().toISOString(),mode:'history_review',roots:[],answers:[],total:records.length,reviewQueue:records};
    sessionPanels();
  }
  function newQuestion() {
    feedbackClock.cancel();stop(true);sequence++;
    let solution,options,task,source=null,probability=null,useReference=false,selection=null;
    if(session.reviewQueue){
      source=session.reviewQueue[session.answers.length];const original=source.question;
      applySound(original);task=original.task||'chord_quality';
      solution=original.progression?{...PracticeModel.option(original.rootMidi,qualityIndex(original.quality)),chords:original.progression.chords,key:Progression.keyOf(original.progression.chords)}:PracticeModel.option(original.rootMidi,qualityIndex(original.quality),task);
      options=original.progression?original.options.map(key=>key.includes('|')?{key,chords:Progression.decode(key)}:PracticeModel.decodeOption(key,original.rootMidi,'chord_identity')):original.options.map(key=>PracticeModel.decodeOption(key,original.rootMidi,task));
      useReference=false;
    }else if(session.plan){
      const planned=session.plan.items[session.answers.length];
      ({solution,options,selection}=planned);task=session.task;useReference=['chord_identity','chord_progression'].includes(task)&&session.reference;
    }else if(session.task==='chord_identity'){
      const generated=PracticeModel.generateIdentity(session.preset,Math.random,session.key);
      ({solution,options}=generated);probability=generated.selectionProbability;task=session.task;useReference=session.reference;
    }else{
      const generated=PracticeModel.generate(session.mode,session.roots);
      task='chord_quality';solution=PracticeModel.option(generated.root,generated.quality,task);
      options=PracticeModel.modes[session.mode].map(i=>PracticeModel.option(generated.root,i,task));probability=generated.selectionProbability;
    }
    const key=['chord_identity','chord_progression'].includes(task)?(source?MusicTheory.recordKey(source.question):session.key):null;
    setActiveKey(key);$('root').value=String(solution.rootMidi);chosen=solution.quality;render();
    const keyInfo=key?MusicTheory.getKey(key):null,referenceQuality=keyInfo?.mode==='natural_minor'?1:0;
    const referenceLabel=keyInfo?titleFor(keyInfo.tonic,referenceQuality,key):'';
    const notes=source?[...source.question.notes]:pitches(chosen),duration=Number($('duration').value),span=strumSpan(notes);
    question={id:earUUID(),solution,quality:solution.quality,root:solution.rootMidi,options,task,notes:[...notes],duration,span,
      key,referenceLabel,degree:keyInfo?keyInfo.scale.find(n=>n.rootMidi===solution.rootMidi)?.degree:null,
      referenceAllowed:ReferencePolicy.applicable({task})&&session.referenceAllowed,referenceBeforeQuestion:useReference,referenceAfterAnswerPlaybackCount:0,referenceNotes:source?.question.referenceNotes?[...source.question.referenceNotes]:notesFor(keyInfo?.tonic||60,referenceQuality),referencePlaybackCount:0,sourceAttemptId:source?.id||null,voicingVersion:source?.question.voicingVersion||(isGuitar()?'guitar-shapes-v3':'root-closed-v1'),
      createdAt:new Date().toISOString(),selectionProbability:probability,selection,adaptiveFailure:session.adaptiveFailure||null,step:session.step?{...session.step}:null,
      answered:false,reviewing:false,correct:null,playbackCount:0,firstPlaybackAt:null,lastPlaybackAt:null,loading:false};
    if(task==='chord_progression'){
      let time=0;const sourceProgression=source?.question.progression,playbackGap=sourceProgression?.gap??Progression.gap;
      const chords=solution.chords.map(c=>{const notes=sourceProgression?[...c.notes]:notesFor(c.rootMidi,qualityIndex(c.quality));const item={rootMidi:c.rootMidi,quality:c.quality,notes,start:time,duration};time+=duration+strumSpan(notes)+playbackGap;return item;});
      question.progression={version:Progression.version,length:chords.length,inputMode:sourceProgression?.inputMode||(options.length===7?'ordered':'four'),gap:playbackGap,chords,candidateMode:sourceProgression?.candidateMode||session.plan?.items[session.answers.length]?.candidateMode||null,candidateGrouping:sourceProgression?.candidateGrouping||session.plan?.items[session.answers.length]?.candidateGrouping||null};
      question.entered=[];question.cursor=0;
    }
    $('progressionFeedback').hidden=true;$('sequenceActions').hidden=!question.progression||question.progression.inputMode!=='ordered';$('answerOptions').classList.toggle('progression-options',!!question.progression);$('answerOptions').classList.toggle('ordered-options',question.progression?.inputMode==='ordered');$('sequenceInput').hidden=!question.progression||question.progression.inputMode!=='ordered';
    $('questionProgress').textContent=`${session.answers.length+1} / ${session.total} 問${session.step?' · ステップ'+session.step.stage:session.reviewQueue?' · 復習':''}`;
    $('sessionPlanHint').hidden=!session.plan;
    $('sessionPlanHint').textContent=session.plan?.policyVersion===EarAdaptive.version?`適応練習 · ${session.plan.effective==='model'?'モデル式':'ルール式'} · 重点${session.plan.weakCount}問＋範囲全体${session.plan.normalCount}問${session.plan.fallbackReason?'（モデル式は履歴不足などのため保留）':''}`:session.step?`ステップ${session.step.stage} · 10問中9問以上正解で次を解放 · ${question.progression?(question.progression.inputMode==='four'?'種類の並びをそろえた4択（登場回数調整5問＋ランダム5問）':'定番パターン5問＋その調の組み合わせ5問'):'範囲全体から10問'}`:session.plan?(question.progression?(question.progression.inputMode==='four'?'コード進行 · 種類の並びをそろえた4択（登場回数調整5問＋ランダム5問）':'コード進行 · 定番パターン5問＋その調の組み合わせ5問'):session.plan.weakCount?`おまかせ復習 · 苦手${session.plan.weakCount}問＋範囲全体から${session.plan.normalCount}問`:'おまかせ復習 · この条件では苦手に該当する履歴がないため、範囲全体から10問'):'';
    $('questionBar').style.width=`${session.answers.length/session.total*100}%`;
    $('questionPrompt').textContent=task==='chord_progression'?keyInfo.label+'。'+question.progression.length+'つのコードを順番に聴いて答えよう。':task==='chord_identity'?keyInfo.label+'。どのコードに聴こえる？':`ルートは ${name(solution.rootMidi)}。どの響き？`;
    $('questionInstrument').textContent=instrumentLabel($('timbre').value)+(['chord_identity','chord_progression'].includes(task)?' · コードの響きを聴いて答えてね':' · コードの種類を選んでね');
    $('answerFeedback').hidden=true;$('feedbackBody').hidden=true;$('feedbackBody').textContent='';$('feedbackTitle').textContent='';$('feedbackTitle').className='';$('replayQuestion').textContent='▶ 問題の音を聴く';$('playReference').hidden=!question.referenceAllowed;paintReferenceUsage();$('playReference').textContent=`▶ 基準の${referenceLabel}を聴く`;
    $('answerOptions').innerHTML=options.map(o=>`<button class="answer-option" data-answer="${o.key}" disabled><strong>${o.chords?Progression.label(o.chords,key):task!=='chord_quality'?titleFor(o.rootMidi,o.quality):types[o.quality].label}</strong><span>${o.chords?'この順番':task!=='chord_quality'?types[o.quality].label:titleFor(o.rootMidi,o.quality)}</span></button>`).join('');
    if(question.progression?.inputMode==='ordered')paintSequence();
    $('dontKnow').hidden=false;$('dontKnow').disabled=true;
    $('nextQuestion').textContent=session.answers.length===session.total-1?'結果を見る →':'次の問題へ →';
    $('replayCount').textContent='';updatePanels();$('practicePanel').scrollIntoView({block:'start',behavior:'auto'});listen();
  }
  function targetEvents(q,offset=0){return q.progression?q.progression.chords.map(c=>({notes:c.notes,t:offset+c.start,len:c.duration})):[{notes:q.notes,t:offset,len:q.duration}];}
  function paintSequence(){
    const q=question;$('sequenceInputHint').textContent='コードのボタンを順番に選んで回答。枠を押すと、その位置を選び直せます。';
    $('sequenceSlots').replaceChildren();
    for(let i=0;i<q.progression.length;i++){
      const button=document.createElement('button');button.className='sequence-slot'+(i===q.cursor?' active':'');button.dataset.sequenceSlot=String(i);
      button.textContent=(i+1)+'. '+(q.entered[i]?Progression.label(Progression.decode(q.entered[i]),q.key):'未選択');
      button.onclick=()=>{if(q.answered||q.loading)return;q.cursor=i;paintSequence();};$('sequenceSlots').append(button);
    }updateAnswerAvailability();
  }
  function enterChord(key){const q=question;if(!q||q.answered||q.loading||!q.playbackCount)return;q.entered[q.cursor]=key;q.cursor=Math.min(q.progression.length-1,q.cursor+1);paintSequence();}
  function comparePosition(q,index){
    const target=q.progression.chords[index],answer=q.selectedChords?.[index],other=answer&&Progression.chordKey(answer)!==Progression.chordKey(target)?answer:q.progression.chords.find(c=>Progression.chordKey(c)!==Progression.chordKey(target));
    chosen=qualityIndex(target.quality);$('root').value=String(target.rootMidi);render();$('aRoot').value=String(target.rootMidi);$('bRoot').value=String(other?.rootMidi??target.rootMidi);renderComparisonOptions();$('a').value=String(qualityIndex(target.quality));$('b').value=String(qualityIndex(other?.quality??target.quality));renderDiff();
    $('feedbackCompare').textContent=(index+1)+'番目：正解の'+chordName(target.rootMidi,target.quality,q.key)+'と'+(other?chordName(other.rootMidi,other.quality,q.key):'同じコード')+'を下で比較できます。';
  }
  function paintProgressionFeedback(q){
    $('progressionPositions').replaceChildren();
    q.progression.chords.forEach((c,i)=>{
      const selected=q.selectedChords?.[i],correct=selected&&Progression.chordKey(selected)===Progression.chordKey(c),row=document.createElement('div');row.className='progression-position';
      const text=document.createElement('p');text.textContent=(i+1)+'番目 '+(correct?'✓':'✕')+' 正解 '+chordName(c.rootMidi,c.quality,q.key)+' / 回答 '+(selected?chordName(selected.rootMidi,selected.quality,q.key):'分からない');row.append(text);
      function button(label,action){const b=document.createElement('button');b.className='secondary';b.textContent=label;b.onclick=()=>{reviewFeedback();action();};row.append(b);}
      button('▶ 正解のコード',()=>play([{notes:c.notes,t:0,len:q.duration}],(i+1)+'番目の正解'));
      if(selected)button('▶ 回答のコード',()=>play([{notes:notesFor(selected.rootMidi,qualityIndex(selected.quality)),t:0,len:q.duration}],(i+1)+'番目の回答'));
      button('この位置を比較',()=>comparePosition(q,i));$('progressionPositions').append(row);
    });
    const mismatch=Progression.positions(q.progression.chords,q.selectedChords).findIndex(v=>!v);comparePosition(q,Math.max(0,mismatch));
  }
  async function listen() {
    if(!question)return;if(question.answered)reviewFeedback();
    const q=question,token=++sequence;
    if(!q.answered){q.loading=true;updateAnswerAvailability();}
    let offset=0,events=[];
    if(q.referenceBeforeQuestion){events.push({notes:q.referenceNotes,t:0,len:q.duration});offset=q.duration+strumSpan(q.referenceNotes)+.7;}
    events.push(...targetEvents(q,offset));
    status('問題の音を準備中…');
    const result=await play(events,q.referenceBeforeQuestion?`基準の${q.referenceLabel} → 問題の音を再生中`:'問題の音を再生中');
    if(result&&(offset>0||q.progression))await new Promise(resolve=>setTimeout(resolve,Math.max(0,(q.progression?result.endAtMs:result.startedAtMs+offset*1000)-Date.now())));
    if(question!==q||sequence!==token)return;q.loading=false;
    if(result&&run===result.playbackToken&&!q.answered){q.playbackCount++;if(q.referenceBeforeQuestion)q.referencePlaybackCount++;q.firstPlaybackAt??=result.startedAtMs+offset*1000;q.lastPlaybackAt=result.startedAtMs+offset*1000;}
    $('replayCount').textContent=q.playbackCount?`回答前の再生：${q.playbackCount}回`:'再生できない場合は、もう一度押してください。';
    updateAnswerAvailability();
  }
  async function reference() {
    if(!question?.referenceAllowed)return;if(question.answered)reviewFeedback();
    const q=question,token=++sequence;q.loading=true;updateAnswerAvailability();
    const result=await play([{notes:q.referenceNotes,t:0,len:q.duration}],`基準の${q.referenceLabel}コードを再生中`);
    if(question!==q||sequence!==token)return;q.loading=false;
    if(ReferencePolicy.recordPlayback(q,!!result&&run===result.playbackToken)){
      if(q.answered&&q.record){q.record.referenceAfterAnswerPlaybackCount=q.referenceAfterAnswerPlaybackCount;if(storageReady)store.saveReferenceAfterCount(q.id,q.referenceAfterAnswerPlaybackCount).catch(()=>notice('回答後の試聴回数を保存できませんでした。履歴のJSON保存をご利用ください。'));}
    }
    paintReferenceUsage();
    updateAnswerAvailability();
  }
  function paintReferenceUsage(){const q=question;$('referenceUsage').hidden=!q||!ReferencePolicy.applicable(q);if(q)$('referenceUsage').textContent=ReferencePolicy.describe({question:q,referencePlaybackCount:q.referencePlaybackCount,referenceAfterAnswerPlaybackCount:q.referenceAfterAnswerPlaybackCount});}
  function updateAnswerAvailability() {
    const disabled=!question || question.answered || question.loading || !question.playbackCount;
    document.querySelectorAll('[data-answer]').forEach(b=>b.disabled=disabled);
    $('dontKnow').disabled=disabled;
    $('sequenceSubmit').disabled=disabled||(question?.entered?.length!==question?.progression?.length||!Array.from(question?.entered||[]).every(Boolean));
    $('sequenceUndo').disabled=disabled||!question?.entered?.length;
    document.querySelectorAll('[data-sequence-slot]').forEach(b=>b.disabled=disabled);
  }
  function makeRecord(q,selected) {
    const instrument=$('timbre').value;
    return{schemaVersion:1,id:q.id,userId,sessionId:session.id,sessionStartedAt:session.startedAt,feedbackSettings:{...behavior},
      answeredAt:new Date().toISOString(),answer:selected?.key??null,correct:selected?.key===q.solution.key,
      playbackCount:q.playbackCount,referencePlaybackCount:q.referencePlaybackCount,referenceAfterAnswerPlaybackCount:q.referenceAfterAnswerPlaybackCount,firstPlaybackAt:new Date(q.firstPlaybackAt).toISOString(),lastPlaybackAt:new Date(q.lastPlaybackAt).toISOString(),
      responseTimeMs:Math.max(0,Date.now()-q.firstPlaybackAt),responseTimeOrigin:'first_target_audio_start',sourceAttemptId:q.sourceAttemptId,
      question:{id:q.id,task:q.task,createdAt:q.createdAt,rootMidi:q.root,quality:types[q.quality].id,notes:q.notes,instrument,duration:q.duration,
        key:q.key,progression:q.progression?{...q.progression,positionCorrect:Progression.positions(q.progression.chords,selected?Progression.decode(selected.key):null)}:null,step:q.step,scaleDegree:q.degree,referenceChordLabel:q.referenceLabel||null,referencePolicyVersion:ReferencePolicy.version,referenceAllowed:q.referenceAllowed,referenceBeforeQuestion:q.referenceBeforeQuestion,referenceNotes:['chord_identity','chord_progression'].includes(q.task)?q.referenceNotes:null,referenceDuration:['chord_identity','chord_progression'].includes(q.task)?q.duration:null,referenceTargetOffsetSeconds:q.referenceBeforeQuestion?q.duration+strumSpan(q.referenceNotes)+.7:0,
        octave:isGuitar()?null:Number($('octave').value),guitarStyle:isGuitar()?$('guitarStyle').value:null,guitarStrings:isGuitar()?GuitarVoicings.strings(q.root,q.quality):null,
        events:targetEvents(q).flatMap(e=>e.notes.map((midi,index)=>({midi,start:e.t+(q.span?index*.028:0),duration:e.len,gain:.65/e.notes.length}))),
        options:q.options.map(o=>o.key),generatorVersion:q.selection?.policyVersion===EarAdaptive.version?EarAdaptive.version:q.progression?Progression.version:q.sourceAttemptId?'history-review-v2':q.step?'curriculum-v1':q.selection?'mixed-review-keys-v2':'uniform-keys-v3',audioVersion:'fluidr3-mp3-v1',voicingVersion:q.voicingVersion,
        adaptiveFailure:q.adaptiveFailure,selectionPolicy:q.sourceAttemptId?'history_review':q.step?'curriculum':q.selection?.policyVersion===EarAdaptive.version?'adaptive_'+q.selection.effective:q.selection?'mixed_review':q.progression?'progression_balanced':'uniform',selection:q.selection,selectionProbability:q.selection?.targetProbabilityWithinSet??q.selectionProbability,probabilityScope:q.selection?.candidateSelection==='set_mean_then_uniform_target'?'uniform_within_adaptive_candidate_set':q.selection||q.step?'balanced_session_plan':q.sourceAttemptId?'manual_review':'independent_question',rootPool:[...session.roots],practiceMode:q.task==='chord_identity'&&!q.sourceAttemptId?q.key+':'+session.preset:session.mode,volume:Number($('volume').value)/100}}
  }
  function answer(selected) {
    const q=question;if(!q||q.answered||q.loading||!q.playbackCount)return;
    q.answered=true;stop(true);sequence++;
    const record=makeRecord(q,selected);q.record=record;attempts.push(record);session.answers.push(record);saveSession();
    if(storageReady)store.add([record]).catch(()=>notice('履歴を保存できませんでした。ページを閉じる前に「履歴を見る」からJSONで保存してください。'));
    $('answerFeedback').hidden=false;$('dontKnow').hidden=true;q.correct=record.correct;
    $('selectionReason').textContent=PracticeModel.selectionExplanation(record);$('selectionReason').hidden=!$('selectionReason').textContent;
    $('feedbackTitle').textContent=record.correct?'✓ 正解！':selected===null?'答えを確認':'✕ 不正解！';$('replayQuestion').textContent='▶ もう一度聴く';
    $('feedbackTitle').className=record.correct?'feedback-correct':'feedback-review';
    $('feedbackBody').hidden=record.correct;
    if(!q.progression)$('feedbackBody').textContent=`正解：${titleFor(q.root,q.quality)}（${types[q.quality].label}） / あなたの回答：${selected===null?'分からない':titleFor(selected.rootMidi,selected.quality)}`;
    if(q.progression){
      $('feedbackBody').textContent='正解：'+Progression.label(q.progression.chords,q.key)+' / あなたの回答：'+(selected?Progression.label(Progression.decode(selected.key),q.key):'分からない');
      q.selectedChords=selected?Progression.decode(selected.key):null;
      $('progressionFeedback').hidden=false;$('playProgressionAnswer').hidden=!selected;paintProgressionFeedback(q);
      document.querySelectorAll('[data-answer]').forEach(b=>{b.classList.toggle('correct-answer',q.progression.inputMode==='four'&&b.dataset.answer===q.solution.key);b.classList.toggle('wrong-answer',!!selected&&!record.correct&&b.dataset.answer===selected.key);});
      updateAnswerAvailability();q.reviewing=FeedbackFlow.shouldReview(behavior.mode,record.correct);presentFeedback();status(record.correct?'正解！':'正解は '+Progression.label(q.progression.chords,q.key)+'。');return;
    }
    const comparison=selected&&selected.key!==q.solution.key?selected:q.options.find(o=>o.key!==q.solution.key);
    chosen=q.quality;render();$('aRoot').value=String(q.root);$('bRoot').value=String(comparison.rootMidi);
    renderComparisonOptions();$('a').value=String(q.quality);$('b').value=String(comparison.quality);renderDiff();
    $('feedbackCompare').textContent=`正解の${titleFor(q.root,q.quality)}と${selected&&selected.key!==q.solution.key?'あなたの回答の':'比較用の'}${titleFor(comparison.rootMidi,comparison.quality)}を聴き比べられます。`;
    document.querySelectorAll('[data-answer]').forEach(b=>{b.classList.toggle('correct-answer',b.dataset.answer===q.solution.key);b.classList.toggle('wrong-answer',!!selected&&!record.correct&&b.dataset.answer===selected.key);});
    updateAnswerAvailability();q.reviewing=FeedbackFlow.shouldReview(behavior.mode,record.correct);presentFeedback();status(record.correct?'正解！':'正解は '+titleFor(q.root,q.quality)+'。');
  }
  function finish(interrupted=false) {
    if (!session) return;
    const returnToSetup=interrupted;
    feedbackClock.cancel();stop(true);sequence++;
    const answered=session.answers.length,correct=session.answers.filter(a=>a.correct).length,total=session.total;
    interrupted=interrupted&&answered<total;saveSession(interrupted?'interrupted':'completed');
    $('sessionResultTitle').textContent=interrupted?'ここまでの練習を記録しました。':'今日の練習、おつかれさま。';
    $('sessionScore').textContent=answered?`${correct} / ${answered}`:'回答なし';
    $('sessionDetail').textContent=`${total}問中${answered}問に回答${interrupted?'して中断':''}。`+(answered?`正答率 ${Math.round(correct/answered*100)}%。`:'')+(interrupted?'未回答の問題は成績に含めません。':'')+' 回答した問題は履歴から聴き直し・復習できます。'+(session.plan?.policyVersion===EarAdaptive.version?` 今回の回答：苦手${session.answers.filter(a=>a.question.selection?.bucket==='weak').length}問・範囲全体から${session.answers.filter(a=>a.question.selection?.bucket==='normal').length}問。`:'');
    $('stepResultStatus').hidden=!session.step;nextStepTarget=null;$('nextStepChallenge').hidden=true;
    if(session.step){
      const stage=session.step.stage,progress=Curriculum.progress(attempts,{key:session.key,instrument:$('timbre').value}),passed=progress[stage-1].passed;
      $('stepResultStatus').textContent=interrupted?'途中までの回答を保存しました。解放判定は10問すべてに回答した挑戦で行います。':correct>=9
        ?stage<7?`ステップ${stage}クリア！ ステップ${stage+1}を解放しました。`:'ステップ7クリア！ 3コード進行までの全ステップを達成しました。'
        :`今回は ${correct} / 10。9問以上正解でクリアです。`+(passed?' 達成済みの記録はそのまま残ります。':'もう一度挑戦できます。');
      if(!interrupted&&stage<7&&progress[stage].unlocked){nextStepTarget={stage:stage+1,key:session.key,sound:{...initial.sound}};$('nextStepChallenge').hidden=false;}
    }
    session=null;question=null;if(initial.sound)applySound(initial.sound);render();paintSteps();
    $('practiceQuestion').hidden=true;$('practiceResults').hidden=returnToSetup;$('practiceSetup').hidden=!returnToSetup;
    updatePanels();$('practicePanel').scrollIntoView({block:'start',behavior:'auto'});status(interrupted?'練習を中断し、ここまでの記録を残しました。':'練習を終了しました。');
  }
  function readBehavior() {
    return FeedbackFlow.normalize({mode:$('feedbackMode').value,delayMs:Number($('feedbackDelay').value),showNextButton:$('showNextButton').checked});
  }
  function paintBehavior() {
    $('feedbackMode').value=behavior.mode;
    $('feedbackDelay').value=String(behavior.delayMs);
    $('showNextButton').checked=behavior.showNextButton;
    $('feedbackDelay').disabled=behavior.mode==='manual';
    $('showNextButton').disabled=behavior.mode==='manual';
    $('behaviorSetupHint').textContent=behavior.mode==='manual'?'毎回答え合わせを確認してから、自分のペースで次へ進みます。':behavior.mode==='wrongStop'?'正解なら自動で次へ。不正解や「分からない」のときは、止まって確認できます。':'正誤を表示して自動で次へ進みます。進み方は上の設定で変更できます。';
    $('behaviorSummary').textContent=behavior.mode==='manual'?'解説を確認して進む':(behavior.mode==='wrongStop'?'不正解で止まる':'自動で次へ')+' · '+behavior.delayMs/1000+'秒';
  }
  function changeBehavior() {
    behaviorChanged=true;behavior=readBehavior();paintBehavior();
    if(storageReady)store.savePreference(behavior).catch(()=>notice('進み方の設定を保存できませんでした。今回の練習には反映しています。'));
    if(question?.answered){question.reviewing=$('behaviorSettings').open||FeedbackFlow.shouldReview(behavior.mode,question.correct);presentFeedback();}
  }
  function advanceQuestion() {
    if(!session || !question?.answered)return;
    feedbackClock.cancel();
    if(session.answers.length>=session.total)finish();else newQuestion();
  }
  function presentFeedback() {
    feedbackClock.cancel();
    if(!session || !question?.answered)return;
    const q=question, reviewing=q.reviewing;
    $('feedbackCompare').hidden=!reviewing;
    $('feedbackHint').hidden=!reviewing;
    if(q.progression){$('progressionFeedback').hidden=!reviewing;$('feedbackHint').textContent='各位置の正解・回答を聴き直し、「この位置を比較」で構成音の違いを確認できます。';}else $('feedbackHint').textContent='下の比較・構成音のボタンで、音の違いを確かめられます。';
    $('reviewFeedback').hidden=reviewing;
    $('nextQuestion').hidden=!reviewing&&!behavior.showNextButton;
    $('autoAdvanceNotice').hidden=reviewing;
    $('autoAdvanceNotice').textContent=`${behavior.delayMs/1000}秒後に${session.answers.length>=session.total?'結果を表示します':'次の問題へ進みます'}。`;
    updatePanels();
    if(!reviewing)feedbackClock.schedule(()=>{
      if(session&&question===q&&q.answered&&!q.reviewing)advanceQuestion();
    },behavior.delayMs);
  }
  function reviewFeedback() {
    if(!question?.answered)return;
    question.reviewing=true;
    presentFeedback();
    status('自動送りを止めました。音を聴き直してから次へ進めます。');
  }
  function targetLabel(record) {return record.question.task==='chord_progression'?recordKeyLabel(record)+' · '+recordChord(record):record.question.task==='chord_identity'?recordKeyLabel(record)+' · '+recordChord(record):qualityLabel(record.question.quality);}
  function answerLabel(record) {
    if(record.answer===null)return '分からない';
    if(record.question.progression)return Progression.label(Progression.decode(record.answer),recordKey(record));
    const o=PracticeModel.decodeOption(record.answer,record.question.rootMidi,record.question.task||'chord_quality');
    return titleFor(o.rootMidi,o.quality,recordKey(record));
  }
  async function playHistory(record) {
    if(session)return;applySound(record.question);chosen=qualityIndex(record.question.quality);render();updatePanels();
    await play(record.question.progression?record.question.progression.chords.map(c=>({notes:c.notes,t:c.start,len:c.duration})):[{notes:record.question.notes,t:0,len:record.question.duration}],recordChord(record)+'（履歴）を再生中');
  }
  function appendSelectionReason(row,record){
    const reason=PracticeModel.selectionExplanation(record);if(!reason)return;
    const p=document.createElement('p');p.className='hint selection-reason';p.textContent=reason;row.append(p);
  }
  function renderHistory() {
    const overview=$('adaptiveHistoryStats');overview.replaceChildren();
    const mine=attempts.filter(a=>a.userId===userId&&a.question.selection?.policyVersion===EarAdaptive.version);
    for(const effective of ['rule','model']){const rows=mine.filter(a=>a.question.selection.effective===effective),predicted=rows.filter(a=>a.question.selection.predictedProbability!==null),p=document.createElement('p');p.className='hint';p.textContent=(effective==='rule'?'ルール式':'モデル式')+'：'+rows.length+'回答'+(rows.length?'・正答率 '+Math.round(100*rows.filter(a=>a.correct).length/rows.length)+'%':'')+'・重点 '+rows.filter(a=>a.question.selection.bucket==='weak').length+'問／範囲全体 '+rows.filter(a=>a.question.selection.bucket==='normal').length+'問'+(predicted.length?'・出題時の予測 Brier '+(predicted.reduce((n,a)=>n+(a.question.selection.predictedProbability-Number(a.correct))**2,0)/predicted.length).toFixed(4):'')+'・モデル式からの切替 '+rows.filter(a=>a.question.selection.requested==='model'&&effective==='rule').length+'問';overview.append(p);}

    const referenceStats=$('historyReferenceStats');referenceStats.replaceChildren();
    for(const usage of ['off','on_unused','on_used','unknown']){const rows=attempts.filter(a=>ReferencePolicy.applicable(a.question)&&ReferencePolicy.usage(a)===usage),correct=rows.filter(a=>a.correct).length,p=document.createElement('p');p.className='hint';p.textContent=ReferencePolicy.usageLabels[usage]+'：'+correct+' / '+rows.length+(rows.length?'（'+Math.round(correct/rows.length*100)+'%）':'');referenceStats.append(p);}
    const total=attempts.length,correct=attempts.filter(a=>a.correct).length;
    $('historyStats').innerHTML=`<div><strong>${total}</strong><span>回答した問題</span></div><div><strong>${total?Math.round(correct/total*100)+'%':'—'}</strong><span>全体の正答率</span></div><div><strong>${new Set([...attempts.map(a=>a.sessionId),...sessions.map(s=>s.id)]).size}</strong><span>練習したセッション</span></div>`;
    $('reviewMistakes').disabled=!attempts.some(a=>!a.correct);
    $('qualityStats').innerHTML=types.slice(0,4).map(t=>{
      const records=attempts.filter(a=>(!a.question.task||a.question.task==='chord_quality')&&a.question.quality===t.id),n=records.length,c=records.filter(a=>a.correct).length;
      return `<tr><td>${t.label}</td><td>${c} / ${n}</td><td>${n?Math.round(c/n*100)+'%':'—'}</td></tr>`;
    }).join('');
    $('identityStats').replaceChildren();
    const identity=attempts.filter(a=>a.question.task==='chord_identity');
    if(!identity.length)$('identityStats').textContent='調を選んで練習すると、調ごとの成績が表示されます。';
    for(const key of MusicTheory.keys){
      const inKey=identity.filter(a=>recordKey(a)===key.id);if(!inKey.length)continue;
      const detail=document.createElement('details');detail.className='session-history-card';
      const summary=document.createElement('summary'),correct=inKey.filter(a=>a.correct).length;
      summary.textContent=`${key.label} · ${correct} / ${inKey.length}（${Math.round(correct/inKey.length*100)}%）`;detail.append(summary);
      for(const o of PracticeModel.identityOptions('diatonic',key.id)){
        const records=inKey.filter(a=>a.question.rootMidi===o.rootMidi&&a.question.quality===types[o.quality].id);if(!records.length)continue;
        const c=records.filter(a=>a.correct).length,p=document.createElement('p');p.className='confusion-row';p.textContent=`${titleFor(o.rootMidi,o.quality,key.id)}：${c} / ${records.length}（${Math.round(c/records.length*100)}%）`;detail.append(p);
      }
      $('identityStats').append(detail);
    }
    const confusions=new Map();
    for(const a of attempts.filter(a=>!a.correct)){
      const label=targetLabel(a)+' → '+(['chord_identity','chord_progression'].includes(a.question.task)?answerLabel(a):a.answer===null?'分からない':qualityLabel(a.answer));
      if(!confusions.has(label))confusions.set(label,{count:0,records:[]});const value=confusions.get(label);value.count++;value.records.push(a);
    }
    $('confusionList').replaceChildren();
    const pairs=[...confusions].sort((a,b)=>b[1].count-a[1].count).slice(0,5);
    if(!pairs.length)$('confusionList').textContent=total?'今のところ、間違えた回答はありません。':'練習すると、間違えやすい組み合わせがここに表示されます。';
    for(const [label,value]of pairs){
      const row=document.createElement('div');row.className='confusion-row history-review-row';
      const text=document.createElement('span');text.textContent=label+'：'+value.count+'回';
      const button=document.createElement('button');button.className='secondary';button.textContent='この間違いを復習';button.onclick=()=>startReview(PracticeModel.reviewQueue(value.records));
      row.append(text,button);$('confusionList').append(row);
    }
    renderSessions();
    $('recentHistory').replaceChildren();
    const recent=[...attempts].sort((a,b)=>Date.parse(b.answeredAt)-Date.parse(a.answeredAt)).slice(0,20);
    if(!recent.length)$('recentHistory').textContent='まだ履歴がありません。まずは10問から始めてみよう。';
    for(const a of recent){
      const row=document.createElement('div');row.className='history-row';
      const text=document.createElement('p');text.textContent=`${a.correct?'✓':'○'} ${a.question.step?'ステップ'+a.question.step.stage+' · ':''}${recordChord(a)} / 回答 ${answerLabel(a)} · ${instrumentLabel(a.question.instrument)} · ${recordKeyLabel(a)} · ${ReferencePolicy.describe(a)} · ${new Date(a.answeredAt).toLocaleString('ja-JP')}`;
      const actions=document.createElement('div');actions.className='history-row-actions';
      const replay=document.createElement('button');replay.className='secondary';replay.textContent='▶ 音を聴く';replay.dataset.historyPlay=a.id;replay.onclick=()=>playHistory(a);
      const review=document.createElement('button');review.className='secondary';review.textContent='もう一度解く';review.dataset.historyReview=a.id;review.onclick=()=>startReview([a]);
      actions.append(replay,review);row.append(text);appendSelectionReason(row,a);row.append(actions);$('recentHistory').append(row);
    }
  }
  function renderSessions() {
    const list=$('sessionHistoryList');list.replaceChildren();
    const grouped=new Map();
    for(const a of attempts){if(!grouped.has(a.sessionId))grouped.set(a.sessionId,[]);grouped.get(a.sessionId).push(a);}
    const known=new Map(sessions.map(s=>[s.id,s]));
    for(const [id,records]of grouped)if(!known.has(id))known.set(id,{id,startedAt:records[0].sessionStartedAt||records[0].answeredAt,status:'legacy',total:null});
    const recent=[...known.values()].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
    if(!recent.length){list.textContent='練習を始めると、完了・中断ごとに記録が残ります。';return;}
    for(const saved of recent){
      const records=(grouped.get(saved.id)||[]).sort((a,b)=>Date.parse(a.answeredAt)-Date.parse(b.answeredAt));
      const correct=records.filter(a=>a.correct).length;
      const state={interrupted:'中断',completed:'完了',in_progress:'未完了',legacy:'過去の練習'}[saved.status];
      const detail=document.createElement('details');detail.className='session-history-card';
      const summary=document.createElement('summary');summary.textContent=`${state}${saved.step?' · ステップ'+saved.step.stage:''}${saved.key?' · '+MusicTheory.getKey(saved.key).label:''}${saved.selectionStrategy==='mixed'?' · おまかせ復習':''} · ${saved.total===null?records.length+'問に回答':saved.total+'問中'+records.length+'問に回答'} · 正解 ${correct}問 · ${new Date(saved.startedAt).toLocaleString('ja-JP')}`;
      detail.append(summary);
      const info=document.createElement('p');info.className='muted';info.textContent=(records.length?`回答した問題の正答率 ${Math.round(correct/records.length*100)}%。`:'回答する前に終了しました。')+(saved.status==='interrupted'?' 未回答の問題は成績に含めません。':'');detail.append(info);
      if(records.length){const review=document.createElement('button');review.className='secondary';review.textContent='この練習をもう一度解く';review.onclick=()=>startReview(records);detail.append(review);}
      for(const a of records){
        const row=document.createElement('div');row.className='history-row';
        const text=document.createElement('p');text.textContent=`${a.correct?'✓ 正解':'✕ 不正解'} · ${recordKeyLabel(a)} · ${recordChord(a)} / 回答 ${answerLabel(a)} · ${ReferencePolicy.describe(a)}`;
        const actions=document.createElement('div');actions.className='history-row-actions';
        const replay=document.createElement('button');replay.className='secondary';replay.textContent='▶ 音を聴く';replay.onclick=()=>playHistory(a);
        const review=document.createElement('button');review.className='secondary';review.textContent='もう一度解く';review.onclick=()=>startReview([a]);
        actions.append(replay,review);row.append(text);appendSelectionReason(row,a);row.append(actions);detail.append(row);
      }
      list.append(detail);
    }
  }
  function updateKeyOptions(){
    const previous=$('practiceKey').value,mode=$('tonalMode').value;
    $('practiceKey').replaceChildren();
    for(const key of MusicTheory.keys.filter(k=>k.mode===mode)){
      const option=document.createElement('option');option.value=key.id;option.textContent=key.tonicName+' · '+key.label;$('practiceKey').append(option);
    }
    if([...$('practiceKey').options].some(o=>o.value===previous))$('practiceKey').value=previous;
    updateTaskSetup();
  }
  function updateTaskSetup(){
    const steps=$('practiceTrack').value==='steps',progression=!steps&&$('practiceTask').value.startsWith('progression'),identity=steps||progression||$('practiceTask').value==='tonal',key=MusicTheory.getKey($('practiceKey').value||'C_major');
    $('referencePermissionSetting').hidden=!identity;$('identityChoicesGroup').hidden=!identity||steps||progression;$('progressionInputGroup').hidden=!progression;
    $('selectionStrategyGroup').hidden=steps;$('adaptiveModelGroup').hidden=steps||$('selectionStrategy').value!=='model';$('practiceTaskGroup').hidden=steps;$('stepOverview').hidden=!steps;$('startPractice').hidden=steps;$('tonalModeGroup').hidden=!identity;$('practiceKeyGroup').hidden=!identity;
    $('qualityModeGroup').hidden=identity;$('qualityRootsGroup').hidden=identity;
    const labels=preset=>PracticeModel.identityOptions(preset,key.id).map(o=>titleFor(o.rootMidi,o.quality,key.id)).join(' / ');
    for(const option of $('identityChoices').options)option.textContent=option.value==='diatonic4'?'その調の7種類から4択（毎問、候補が変わります）':labels(option.value)+`（${option.value==='cf'?2:option.value==='cfg'?3:7}択）`;
    const referenceLabel=titleFor(key.tonic,key.mode==='natural_minor'?1:0,key.id);
    $('taskHelp').textContent=progression?'順番まで全て合えば1問正解です。回答後は各位置の正解・回答を聴き比べられます。自然短調では音階内の三和音だけを使います。':identity?`正解のルートは表示しません。${key.label}に含まれるコードを聴き分けます。`+(key.mode==='natural_minor'?' 自然短音階に含まれる三和音を出題します。':''):'ルートを表示し、メジャー／マイナーなどの種類を答えます。全12音のルートを混ぜることもできます。';
    updateSelectionSetup();
    $('practiceDescription').textContent=progression?key.label+'の2・3コード進行を聴き分けよう。その調のコードの組み合わせを出題します。':identity?key.label+'の中でコードを聴き分けよう。上で選んだ楽器で出題するよ。':'ルートを見ながら、コードの種類を答えます。上で選んだ楽器で出題するよ。';
    paintSteps();updatePanels();
  }
  function updateSelectionSetup(){
    $('selectionHelp').hidden=$('practiceTrack').value==='steps';$('adaptiveModelGroup').hidden=$('selectionHelp').hidden||$('selectionStrategy').value!=='model';
    $('selectionHelp').textContent=$('selectionStrategy').value==='uniform'?'選んだ範囲から出題します。進行4択は候補を先に作り、正解を25%で選びます。':'重点5問＋範囲全体5問。コード・隣接ペア・取り違えの出題前の成績から苦手を優先します。履歴がなければ全体から10問。モデル式は履歴不足ならルール式へ切り替えます。出題理由は回答後に表示します。進行4択は候補の組を優先し、その中から正解を25%で選びます。';

  }
  function paintSteps(){
    const key=$('practiceKey').value||'C_major',instrument=$('timbre').value;
    const progress=Curriculum.progress(attempts,{key,instrument});
    $('stepContext').textContent=instrumentLabel(instrument)+' · '+MusicTheory.getKey(key).label+' の達成状況';
    $('stepCards').replaceChildren();
    for(const level of progress){
      const card=document.createElement('div');card.className='step-card'+(level.passed?' passed':'')+(level.unlocked?' unlocked':'');
      const title=document.createElement('h3');title.textContent=level.id+'. '+level.title;
      const badge=document.createElement('span');badge.className='step-badge';badge.textContent=!level.implemented?'準備中':level.passed?'✓ 達成済み':level.unlocked?'挑戦できます':'未解放';
      const description=document.createElement('p');description.textContent=level.description;
      const detail=document.createElement('p');detail.className='hint';detail.textContent=level.best===null?'':`最高 ${level.best} / 10 · 完了した挑戦 ${level.completedCount}回`+(level.passedReferenceConditions?.length?' · 達成時：'+level.passedReferenceConditions.map(p=>ReferencePolicy.labels[p]||p).join('／'):'');
      const button=document.createElement('button');button.className=level.unlocked?'primary':'secondary';button.dataset.stepStart=String(level.id);
      button.textContent=!level.implemented?'次の更新で追加':level.unlocked?(level.passed?'もう一度挑戦':'このステップに挑戦'):'前のステップをクリアすると解放';
      button.disabled=!historyLoaded||!level.unlocked||!!session;button.onclick=()=>start(level.id);
      card.append(title,badge,description,detail,button);$('stepCards').append(card);
    }
  }
  function changeTrack(){
    updateTaskSetup();updateSelectionSetup();
  }
  function startNextStep(){
    if(!nextStepTarget)return;const target=nextStepTarget;nextStepTarget=null;
    applySound(target.sound);$('practiceTrack').value='steps';$('tonalMode').value=MusicTheory.getKey(target.key).mode;updateKeyOptions();$('practiceKey').value=target.key;changeTrack();start(target.stage);
  }
  async function exportHistory() {
    await init;
    const blob=new Blob([JSON.stringify({format:'ear-lab-history',schemaVersion:1,exportedAt:new Date().toISOString(),attempts,sessions,adaptiveModels:adaptiveSnapshots},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='ear-lab-history-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('historyMessage').textContent=`${attempts.length}件の履歴を書き出しました。`;
  }
  async function importHistory(event) {
    const file=event.target.files[0];if(!file)return;
    try{
      await init;
      if(file.size>30*1024*1024)throw new Error('30MB以下の履歴JSONを選んでください。');
      const backup=JSON.parse(await file.text());
      const records=PracticeModel.validateBackup(backup),restoredSessions=backup.sessions||[];
      const ids=new Set(attempts.map(a=>a.id)),fresh=records.filter(a=>!ids.has(a.id));
      if(storageReady)await store.add(fresh);
      attempts.push(...fresh);paintSteps();
      for(const saved of restoredSessions){if(sessions.some(s=>s.id===saved.id))continue;if(storageReady)await store.saveSession(saved);sessions.push(saved);}
      for(const snapshot of backup.adaptiveModels||[]){if(adaptiveSnapshots.some(s=>s.id===snapshot.id))continue;adaptiveSnapshots.push(snapshot);if(storageReady)await store.saveAdaptiveModel(snapshot.id.slice('adaptive:model:'.length),snapshot.value);}
      renderHistory();
      $('historyMessage').textContent=`${fresh.length}件を復元しました。重複する回答は変更していません。`;
    }catch(error){$('historyMessage').textContent=error instanceof SyntaxError?'JSONを読み取れませんでした。履歴は変更していません。':error.message;}
    finally{event.target.value='';}
  }
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $('allowReference').onchange=()=>{referenceChanged=true;const value=$('allowReference').checked;init.then(()=>{if(storageReady)store.saveReferencePreference(value).catch(()=>notice('基準コードの設定を保存できませんでした。今回の練習には反映しています。'));});};
  $('startPractice').onclick=()=>start();$('replayQuestion').onclick=listen;$('playReference').onclick=reference;
  $('answerOptions').onclick=event=>{const b=event.target.closest('[data-answer]');if(b){if(question?.progression?.inputMode==='ordered')enterChord(b.dataset.answer);else answer(question.options.find(o=>o.key===b.dataset.answer));}};
  $('dontKnow').onclick=()=>answer(null);
  $('sequenceUndo').onclick=()=>{if(question?.answered||question?.loading)return;question.entered.pop();question.cursor=question.entered.length;paintSequence();};
  $('sequenceSubmit').onclick=()=>{const q=question;if(q?.entered.length===q?.progression?.length&&Array.from(q.entered).every(Boolean))answer({key:q.entered.join('|')});};
  $('playProgressionAnswer').onclick=()=>{const q=question;if(!q?.selectedChords)return;reviewFeedback();let t=0;play(q.selectedChords.map(c=>{const notes=notesFor(c.rootMidi,qualityIndex(c.quality)),event={notes,t,len:q.duration};t+=q.duration+strumSpan(notes)+q.progression.gap;return event;}),'自分の回答の進行');};
  $('reviewFeedback').onclick=reviewFeedback;
  $('nextQuestion').onclick=advanceQuestion;
  $('endPractice').onclick=()=>finish(true);
  $('stop').addEventListener('click',()=>{if(question?.answered)reviewFeedback();});
  $('behaviorSettings').addEventListener('toggle',()=>{if($('behaviorSettings').open&&question?.answered)reviewFeedback();});
  $('gap').addEventListener('change',()=>lockSettings(!!session));
  $('practiceAgain').onclick=()=>{$('practiceResults').hidden=true;$('practiceSetup').hidden=false;};
  $('sessionHistory').onclick=()=>setView('history');
  $('reviewMistakes').onclick=()=>startReview(PracticeModel.reviewQueue(attempts));
  $('practiceTrack').onchange=changeTrack;$('nextStepChallenge').onclick=startNextStep;
  document.querySelectorAll('[data-instrument]').forEach(button=>button.addEventListener('click',paintSteps));$('synthTone').addEventListener('change',paintSteps);
  $('practiceTask').onchange=()=>{updateTaskSetup();updateSelectionSetup();};$('practiceKey').onchange=updateTaskSetup;$('tonalMode').onchange=updateKeyOptions;
  $('selectionStrategy').onchange=updateSelectionSetup;
  $('exportHistory').onclick=exportHistory;$('importHistory').onchange=importHistory;
  for(const id of ['feedbackMode','feedbackDelay','showNextButton'])$(id).onchange=changeBehavior;
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&question?.answered)reviewFeedback();});
  paintBehavior();updateKeyOptions();updateSelectionSetup();
  setView('practice');
})();
