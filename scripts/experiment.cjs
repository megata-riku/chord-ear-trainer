const fs=require('node:fs'),path=require('node:path');
try{
 const [input,output,user]=process.argv.slice(2);if(!input||!output){console.log('Usage: node scripts/experiment.cjs HISTORY.json OUTPUT.json [USER_ID]\nRuns the same chronological experiment as the browser. Output may contain private history; keep it outside Git.');process.exitCode=1;}else{
 const backup=JSON.parse(fs.readFileSync(input,'utf8')),{PracticeModel:M,EarPrediction:E}=require('./runtime.cjs')(),records=M.validateBackup(backup),users=[...new Set(records.map(r=>r.userId))];if(!user&&users.length!==1)throw new Error('利用者が複数または0人です。第3引数でUSER_IDを指定してください。');if(user&&!users.includes(user))throw new Error('指定した利用者の履歴がありません。');
 const report=E.run(records,{userId:user||users[0],task:'all',key:'all',reference:'all'});fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');if(report.status!=='ready'){console.error(report.summary.needs.join('\n'));process.exitCode=2;}else{console.log('Train '+report.summary.trainCount+' / Test '+report.summary.testCount);for(const [key,m]of Object.entries(report.metrics))console.log(key+'\tBrier '+m.brier.toFixed(6)+'\tLog loss '+m.logLoss.toFixed(6));console.log('共有設定: '+report.selection.status);}
 }
}catch(error){console.error(error.message);process.exitCode=1;}
