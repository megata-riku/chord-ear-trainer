'use strict';
const Curriculum=(()=>{
  const version='curriculum-v1';
  const stages=[
    {id:1,title:'単一コード · 3択',description:'主和音・第4音・第5音上の和音を聴き分ける',preset:'cfg',implemented:true},
    {id:2,title:'単一コード · 4択',description:'その調の7種類から出題。毎問、正解とほかの3候補を表示',preset:'diatonic4',implemented:true},
    {id:3,title:'単一コード · 全7択',description:'その調の7種類すべてから選ぶ',preset:'diatonic',implemented:true},
    {id:4,title:'2コード進行 · 4択',description:'進行全体のボタンから選ぶ',preset:'two_four',implemented:true},
    {id:5,title:'2コード進行 · 順番入力',description:'コードのボタンを順番に選ぶ',preset:'two_ordered',implemented:true},
    {id:6,title:'3コード進行 · 4択',description:'進行全体のボタンから選ぶ',preset:'three_four',implemented:true},
    {id:7,title:'3コード進行 · 順番入力',description:'コードのボタンを順番に選ぶ',preset:'three_ordered',implemented:true}
  ];
  function validRecord(record){
    const q=record.question,s=q?.step,stage=stages.find(level=>level.id===s?.stage);
    if(q?.task==='chord_progression')return Progression.validRecord(record)&&!!s&&s.stage>=4;
    if(s?.version!==version||!stage?.implemented||s.preset!==stage.preset||q.task!=='chord_identity'||!MusicTheory.validKey(q.key)||record.sourceAttemptId||q.selectionPolicy!=='curriculum')return false;
    const domain=PracticeModel.identityOptions(stage.preset,q.key).map(o=>o.key),expectedCount=stage.id===1?3:stage.id===2?4:7;
    return q.options.length===expectedCount&&new Set(q.options).size===expectedCount&&q.options.every(o=>domain.includes(o))&&domain.includes(q.rootMidi+':'+q.quality)&&q.options.includes(q.rootMidi+':'+q.quality)&&record.correct===(record.answer===q.rootMidi+':'+q.quality);
  }
  function progress(records,{key,instrument}){
    const grouped=new Map(),seen=new Set();
    for(const record of records){if(seen.has(record.id))continue;seen.add(record.id);if(!grouped.has(record.sessionId))grouped.set(record.sessionId,[]);grouped.get(record.sessionId).push(record);}
    const completed=[];
    for(const rows of grouped.values()){
      if(rows.length!==10||!rows.every(validRecord))continue;
      const first=rows[0],stage=first.question.step.stage;
      if(!rows.every(r=>r.question.step.stage===stage&&r.question.key===key&&r.question.instrument===instrument&&r.userId===first.userId))continue;
      completed.push({referencePermission:ReferencePolicy.permission(first.question),stage,correct:rows.filter(r=>r.correct).length,sessionId:first.sessionId,completedAt:new Date(Math.max(...rows.map(r=>Date.parse(r.answeredAt)))).toISOString()});
    }
    let previousPassed=true;
    return stages.map(stage=>{
      const runs=completed.filter(run=>run.stage===stage.id),best=runs.length?Math.max(...runs.map(run=>run.correct)):null;
      const passed=stage.implemented&&previousPassed&&best!==null&&best>=9,unlocked=stage.implemented&&previousPassed;
      previousPassed=passed;
      return{...stage,passed,unlocked,best,passedReferenceConditions:[...new Set(runs.filter(r=>r.correct>=9).map(r=>r.referencePermission))],completedCount:runs.length};
    });
  }
  function createPlan(stage,key,random=Math.random){
    const level=stages.find(s=>s.id===stage);if(!level?.implemented)throw new Error('このステップは準備中です。');
    return stage<=3?PracticeModel.buildBalancedIdentityPlan(level.preset,key,random):Progression.createPlan(stage<=5?2:3,[4,6].includes(stage)?'four':'ordered',key,random);
  }
  return{version,stages,validRecord,progress,createPlan};
})();
