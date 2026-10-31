'use strict';
const ReferencePolicy=(()=>{
  const version='manual-reference-v1';
  const applicable=q=>['chord_identity','chord_progression'].includes(q?.task);
  const labels={on:'試聴オン',off:'試聴オフ',unknown:'許可不明（旧履歴）',na:'対象外'};
  const usageLabels={on_used:'オン・回答前に使用',on_unused:'オン・回答前は未使用',off:'試聴オフ',unknown:'条件・使用状況不明',na:'対象外'};
  const validCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
  function permission(q){return !applicable(q)?'na':typeof q.referenceAllowed==='boolean'?(q.referenceAllowed?'on':'off'):'unknown';}
  function usage(record){const p=permission(record.question);return p==='on'?(validCount(record.referencePlaybackCount)?record.referencePlaybackCount>0?'on_used':'on_unused':'unknown'):p;}
  function describe(record){const p=permission(record.question);if(p==='na')return '基準コード：対象外';return '基準コード：'+labels[p]+(validCount(record.referencePlaybackCount)?'・回答前'+record.referencePlaybackCount+'回':'')+(validCount(record.referenceAfterAnswerPlaybackCount)?'・回答後'+record.referenceAfterAnswerPlaybackCount+'回':'');}
  function validRecord(record){
    const q=record?.question;if(!q)return false;
    for(const field of ['referencePlaybackCount','referenceAfterAnswerPlaybackCount'])if(record[field]!==undefined&&!validCount(record[field]))return false;
    if(q.referencePolicyVersion===undefined&&q.referenceAllowed===undefined)return true;
    if(q.referencePolicyVersion!==version||typeof q.referenceAllowed!=='boolean'||!validCount(record.referencePlaybackCount)||!validCount(record.referenceAfterAnswerPlaybackCount)||q.referenceBeforeQuestion!==false)return false;
    if((!applicable(q)||!q.referenceAllowed)&&(record.referencePlaybackCount!==0||record.referenceAfterAnswerPlaybackCount!==0||q.referenceAllowed&&!applicable(q)))return false;
    return true;
  }
  function recordPlayback(question,success){if(!success||!question.referenceAllowed||!applicable(question))return false;const field=question.answered?'referenceAfterAnswerPlaybackCount':'referencePlaybackCount';question[field]=(question[field]||0)+1;return true;}
  return{version,applicable,permission,usage,describe,labels,usageLabels,validCount,validRecord,recordPlayback};
})();
