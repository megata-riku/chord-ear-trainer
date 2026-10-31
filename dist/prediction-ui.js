'use strict';
class PredictionPanel {
  constructor({store,notice}){
    this.store=store;this.notice=notice;this.report=null;this.userId=null;this.records=[];
    document.getElementById('runPrediction').onclick=()=>this.run();
    document.getElementById('exportPrediction').onclick=()=>this.export();
    document.getElementById('predictionCalibrationModel').onchange=()=>this.paintCalibration();
    for(const id of ['predictionUser','predictionTask','predictionKey','predictionReference'])document.getElementById(id).onchange=()=>{this.report=null;this.paintSummary();this.paintReport();};
  }
  async open(records,currentUserId,storageReady){
    this.records=[...records];this.storageReady=storageReady;
    const keySelect=document.getElementById('predictionKey'),previousKey=keySelect.value||'all';keySelect.replaceChildren();
    const allKeys=document.createElement('option');allKeys.value='all';allKeys.textContent='すべての調・ルート';keySelect.append(allKeys);
    for(const key of MusicTheory.keys){const o=document.createElement('option');o.value=key.id;o.textContent=key.label;keySelect.append(o);}keySelect.value=previousKey;
    const select=document.getElementById('predictionUser'),previous=select.value;
    const users=new Map();for(const r of records)users.set(r.userId,(users.get(r.userId)||0)+1);
    if(!users.size)users.set(currentUserId,0);
    select.replaceChildren();let i=0;
    for(const [id,count]of users){i++;const o=document.createElement('option');o.value=id;o.textContent=(id===currentUserId?'現在の利用者':'履歴の利用者 '+i)+`（${count}回答）`;select.append(o);}
    select.value=users.has(previous)?previous:users.has(currentUserId)?currentUserId:[...users].sort((a,b)=>b[1]-a[1])[0][0];
    if(!this.loadedReport&&storageReady){
      this.loadedReport=true;
      try{const saved=await this.store.predictionReport();
        if(saved?.format==='ear-lab-prediction-experiment'){
          this.report=saved;
          if(users.has(saved.config.userId)){select.value=saved.config.userId;if(['all','chord_identity','chord_quality','chord_progression'].includes(saved.config.task))document.getElementById('predictionTask').value=saved.config.task;document.getElementById('predictionKey').value=saved.config.key||'all';document.getElementById('predictionReference').value=saved.config.reference||'all';}
        }
      }catch(error){/* A report is optional; answer history is unaffected. */}
    }
    this.paintSummary();this.paintReport();
  }
  config(){return{userId:document.getElementById('predictionUser').value,task:document.getElementById('predictionTask').value,key:document.getElementById('predictionKey').value,reference:document.getElementById('predictionReference').value||'all'};}
  paintSummary(){
    const keySelect=document.getElementById('predictionKey');keySelect.disabled=document.getElementById('predictionTask').value==='chord_quality';if(keySelect.disabled)keySelect.value='all';
    const summary=EarPrediction.prepare(this.records,this.config()).summary,list=document.getElementById('predictionNeeds');
    document.getElementById('predictionDataCount').textContent=`有効な回答 ${summary.eligible}件 · 練習 ${summary.sessions}回`;
    list.replaceChildren();
    for(const need of summary.needs){const li=document.createElement('li');li.textContent=need;list.append(li);}
    document.getElementById('predictionReadiness').textContent=summary.needs.length?'最初の比較までに必要な履歴':'比較を実行できます。少ないデータでの結果なので、今後の練習でも確認していきましょう。';
    document.getElementById('runPrediction').disabled=summary.needs.length>0||this.running;
    this.paintSharedAnalysis(EarPrediction.analyze(this.records,this.config()));
    const excluded=summary.excluded.invalid+summary.excluded.missingTime+summary.excluded.duplicate;
    document.getElementById('predictionExcluded').textContent=(excluded?`出題時刻がない履歴など${excluded}件を除外しています。`:'')+(summary.excluded.unsupported?` 未対応の問題${summary.excluded.unsupported}件を除外しています。`:'');
  }
  async run(){
    if(this.running)return;this.running=true;this.paintSummary();
    const message=document.getElementById('predictionMessage');message.textContent='ブラウザ内で学習・比較しています…';
    const records=[...this.records],config=this.config();let worker;
    try{
      const result=await new Promise((resolve,reject)=>{
        worker=new Worker('prediction-worker.js?v=26');
        worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);
        worker.onerror=()=>reject(new Error('予測実験を開始できませんでした。再読み込みして試してください。'));
        worker.postMessage({records,config});
      });
      if(result.status!=='ready'){message.textContent='比較用の履歴がまだ足りません。練習を続けてから試してください。';return;}
      this.report=result;this.paintReport();message.textContent='比較が終わりました。予測誤差と、使った履歴の範囲を確認できます。';
      if(this.storageReady)await this.store.savePredictionReport(result).catch(()=>{message.textContent+=' 実験結果を保存できませんでした。「実験結果をJSONで保存」を使ってください。';});
    }catch(error){message.textContent=error.message;}
    finally{worker?.terminate();this.running=false;this.paintSummary();}
  }
  paintReport(){
    const panel=document.getElementById('predictionResults'),r=this.report;
    panel.hidden=!r;document.getElementById('exportPrediction').disabled=!r;if(!r)return;
    const cfg=this.config(),same=r.config.userId===cfg.userId&&r.config.task===cfg.task&&(r.config.key||'all')===cfg.key&&(r.config.reference||'all')===cfg.reference;
    document.getElementById('predictionReportNotice').textContent=(same?'保存した実験結果':'別の利用者・出題範囲で保存した実験結果')+' · '+new Date(r.createdAt).toLocaleString('ja-JP')+` ／ ${r.experimentVersion||r.model.version}。新しい回答を含めるときは、比較をもう一度実行してください。`;
    document.getElementById('predictionSplit').textContent=`学習：${r.summary.trainCount}回答・${r.summary.trainSessions}回の練習 ／ 評価：${r.summary.testCount}回答・${r.summary.testSessions}回の練習。分割時刻：${new Date(r.protocol.cutoff).toLocaleString('ja-JP')}。`+(r.summary.boundaryExcluded?`分割時刻をまたいだ練習の${r.summary.boundaryExcluded}回答を評価対象から除外しました。`:'');
    const metrics=document.getElementById('predictionMetrics');metrics.replaceChildren();
    const modelKeys=Object.keys(r.metrics),labels={...EarPrediction.modelLabels,...r.modelLabels};
    for(const key of modelKeys){const label=labels[key]||key;
      const tr=document.createElement('tr');for(const value of [label,r.metrics[key].brier.toFixed(4),r.metrics[key].logLoss.toFixed(4)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}metrics.append(tr);
    }
    document.getElementById('predictionDifference').textContent='条件別集計に対するBrierスコアの差：'+modelKeys.filter(k=>!['global','condition'].includes(k)).map(k=>labels[k]+' '+(r.metrics[k].brier-r.metrics.condition.brier).toFixed(4)).join(' ／ ')+'。負なら今回の評価では誤差が小さい値です。この評価結果だけで採用モデルを確定せず、次に集まる回答でも確認します。学習効果とは別の評価です。';
    this.paintEvaluationCoverage();
    this.paintTransferComparison();
    this.paintPooling();
    this.paintConfusionComparison();
    this.paintCalibration();
    const groups=document.getElementById('predictionGroups');groups.replaceChildren();
    const appendGroup=(label,models)=>{const p=document.createElement('p');p.className='hint';p.textContent=label+`：評価${models.logistic.count}件 ／ Brier `+Object.keys(models).map(k=>(labels[k]||k)+' '+(models[k].brier===null?'—':models[k].brier.toFixed(4))).join('・');groups.append(p);};
    for(const group of r.formatGroups||r.groups){appendGroup((group.label?group.label+'（学習'+group.trainCount+'件）':null)||(group.task==='chord_identity'?'調の中でコードを当てる':group.task==='chord_progression'?'コード進行':'コードの種類を当てる'),group.models);}
    for(const group of r.referenceUsageGroups||[]){appendGroup('基準コード：'+group.label,group.models);}
    for(const group of r.candidateGroups||[]){appendGroup(group.candidateMode==='balanced'?'進行4択：登場回数をそろえた候補':'進行4択：ランダムな候補',group.models);}
    for(const group of r.candidateGroupingGroups||[]){appendGroup(group.candidateGrouping==='quality-grouped-v1'?'進行：major／minor・dimの候補調整あり':'進行：旧方式の候補',group.models);}
    for(const group of r.keyGroups||[]){appendGroup(group.key?MusicTheory.getKey(group.key).label:'調を固定しないルートの練習',group.models);}
    const policyLabels={mixed_review:'おまかせ復習',uniform:'均等出題',adaptive_rule:'適応出題・ルール式',adaptive_model:'適応出題・モデル式',history_review:'履歴からの復習',curriculum:'ステップ練習',legacy:'過去の出題',progression_balanced:'進行の自由練習'};
    const policies=document.createElement('p');policies.className='hint';policies.textContent='評価に含まれる出題：'+r.policyGroups.map(g=>(policyLabels[g.policy]||'その他')+' '+g.count+'件').join(' ／ ');groups.append(policies);
  }
  paintSharedAnalysis(analysis){
    const panel=document.getElementById('predictionSharedAnalysis'),body=document.getElementById('predictionSharedTables');body.replaceChildren();panel.hidden=false;
    const c=analysis.coverage;document.getElementById('predictionSharedCoverage').textContent=`共有に使った回答：単一コード ${c.singleAnswers}問・順番入力 ${c.orderedAnswers}問。部分の成績に含めない回答：進行4択 ${c.skippedFourChoice}問・順番入力の「分からない」 ${c.skippedUnknownSequence}問。`;
    const instrument={piano:'ピアノ',guitar:'アコギ',electric:'エレキ',soft:'合成音・やわらかい',clear:'合成音・明るい',sine:'合成音・まるい'},fraction=s=>s?`${s.c} / ${s.n}`:'—';
    const table=(title,rows,pair=false)=>{
      const h=document.createElement('h4');h.textContent=title;body.append(h);
      if(!rows.length){const p=document.createElement('p');p.className='hint';p.textContent='この集計に使える回答はまだありません。';body.append(p);return;}
      const wrapper=document.createElement('div');wrapper.className='table-scroll';const t=document.createElement('table');t.className='history-table';const head=document.createElement('thead'),tr=document.createElement('tr');
      for(const name of ['対象・調・楽器',pair?'両方正解 / 観測数':'正解 / 観測数','単一コード','2コード','3コード']){const th=document.createElement('th');th.textContent=name;tr.append(th);}head.append(tr);t.append(head);
      const tb=document.createElement('tbody');for(const row of [...rows].sort((a,b)=>a.smoothed-b.smoothed||b.n-a.n).slice(0,12)){const tr=document.createElement('tr');for(const value of [row.label+' · '+(row.keys?.length>1?'複数の調（'+row.keys.map(k=>MusicTheory.getKey(k).label).join('・')+'）':MusicTheory.getKey(row.key).label)+' · '+(instrument[row.instrument]||row.instrument)+' · '+(ReferencePolicy.labels[row.referencePermission]||'許可不明'),`${row.c} / ${row.n}（${Math.round(row.accuracy*100)}%）`,fraction(row.sources.single),fraction(row.sources.two),fraction(row.sources.three)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}tb.append(tr);}t.append(tb);wrapper.append(t);body.append(wrapper);
    };
    table('コードごとの観測',analysis.codes);table('隣り合う2コードの観測',analysis.pairs,true);table('音階上の動きごとの観測',analysis.motions,true);
    if(analysis.confusions.length){const h=document.createElement('h4');h.textContent='取り違えたコード';body.append(h);for(const row of analysis.confusions.slice(0,8)){const p=document.createElement('p');p.className='hint';p.textContent=row.label+' → '+row.answerLabel+'：'+row.n+'回 · '+(row.keys?.length>1?'複数の調（'+row.keys.map(k=>MusicTheory.getKey(k).label).join('・')+'）':MusicTheory.getKey(row.key).label)+' · '+(instrument[row.instrument]||row.instrument)+' · '+(ReferencePolicy.labels[row.referencePermission]||'許可不明');body.append(p);}}
  }
  paintEvaluationCoverage(){
    const r=this.report,panel=document.getElementById('predictionCoverage'),body=document.getElementById('predictionCoverageRows');body.replaceChildren();panel.hidden=!r?.coverageGroups;if(panel.hidden)return;
    for(const group of r.coverageGroups){const tr=document.createElement('tr');for(const value of [group.label+' · '+ReferencePolicy.labels[group.referencePermission],group.trainCount,group.trainCorrect,group.trainIncorrect,group.testCount,group.testCorrect,group.unseenInTraining?'学習0件の形式を評価':group.trainCount&&(group.trainCorrect===0||group.trainIncorrect===0)?'学習の正誤が片方のみ':'']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}
    const missing=r.coverageGroups.filter(g=>g.unseenInTraining);document.getElementById('predictionCoverageNote').textContent=missing.length?'学習側にない形式・試聴条件が'+missing.length+'種類あります。その形式を学習した予測精度とは区別して読んでください。':'学習・評価の件数と正誤の内訳を確認してください。少ない件数の結果は今後の回答でも確かめます。';
  }
  paintTransferComparison(){
    const r=this.report,panel=document.getElementById('predictionTransferComparison'),body=document.getElementById('predictionTransferRows');body.replaceChildren();panel.hidden=!r?.transferComparison||!r.pooling;if(panel.hidden)return;
    const labels={logistic:'ロジスティック回帰',tree:'決定木',boosted:'勾配ブースティング'};
    for(const result of r.transferComparison){const tr=document.createElement('tr');for(const value of [labels[result.model],r.metrics[result.base].brier.toFixed(4),r.metrics[result.withShared].brier.toFixed(4),result.brierDifference.toFixed(4),result.logLossDifference.toFixed(4)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}
  }
  paintConfusionComparison(){
    const r=this.report,panel=document.getElementById('predictionConfusionComparison'),body=document.getElementById('predictionConfusionRows');body.replaceChildren();panel.hidden=!r?.confusionComparison;if(panel.hidden)return;
    for(const part of r.confusionComparison){const tr=document.createElement('tr');for(const value of [({logistic:'回帰',tree:'決定木',boosted:'ブースティング'})[part.model],r.metrics[part.without].brier.toFixed(4),r.metrics[part.with].brier.toFixed(4),part.brierDifference.toFixed(4),part.logLossDifference.toFixed(4)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}
  }
  paintPooling(){
    const r=this.report,panel=document.getElementById('predictionPooling');panel.hidden=!r?.selection||!r.metrics.auto_logistic;if(panel.hidden)return;
    const s=r.selection,labels={logistic:'回帰',tree:'決定木',boosted:'ブースティング'},axes={instrument:'アコギ↔エレキ',role:'同じ役割・別の調',root:'同じルート・別の種類',overlap:'構成音の重なり'};
    document.getElementById('predictionPoolingStatus').textContent=s.status==='deferred'?'自動選択は保留・履歴不足。固定の初期設定を使っています。':'共有設定を学習側の時系列検証で選びました。';
    const body=document.getElementById('predictionPoolingRows');body.replaceChildren();
    for(const key of Object.keys(labels)){const tr=document.createElement('tr');for(const v of [labels[key],r.metrics['base_'+key].brier.toFixed(4),r.metrics[key].brier.toFixed(4),r.metrics['auto_'+key].brier.toFixed(4),s.profiles.find(p=>p.id===s.byModel[key].selectedProfile).label]){const td=document.createElement('td');td.textContent=v;tr.append(td);}body.append(tr);}
    const details=document.getElementById('predictionPoolingDetails');details.replaceChildren();
    const line=t=>{const p=document.createElement('p');p.className='hint';p.textContent=t;details.append(p);};
    line('自動選択：'+(s.reasons.length?s.reasons.join(' ／ '):'内側の学習 '+s.trainIds.length+'件・検証 '+s.validationIds.length+'件。分割時刻 '+new Date(s.innerCutoff).toLocaleString('ja-JP')));
    for(const p of s.profiles)line(p.label+'：借りる上限 '+p.cap+'件相当 ／ アコギ↔エレキ '+p.instrument+'・同じ役割 '+p.role+'・同じルート '+p.root+'・構成音の重なり × '+p.overlap+' ／ 類似ペアはさらに × '+p.pairScale);
    for(const [key,value] of Object.entries(s.byModel))for(const c of value.candidates)line(labels[key]+'・'+s.profiles.find(p=>p.id===c.profile).label+'：内側の検証 '+c.count+'件 ／ Brier '+c.brier.toFixed(4)+' ／ Log loss '+c.logLoss.toFixed(4));
    line('関係ごとの追加効果：各関係だけを有効にして学習し直し、同じ未来の問題で比較しています。差は各関係あり−直接履歴。各関係の和が全共有の効果になるわけではありません。');
    for(const a of r.relationAblations||[])line(axes[a.axis]+'：'+Object.keys(labels).map(k=>labels[k]+' Brier差 '+(a.metrics[k].brier-r.metrics['base_'+k].brier).toFixed(4)+' / Log loss差 '+(a.metrics[k].logLoss-r.metrics['base_'+k].logLoss).toFixed(4)).join(' ／ '));
    const chordLabel=value=>{const [root,quality]=value.split(':');return MusicTheory.chordName(Number(root),quality);},instrumentLabel={guitar:'アコギ',electric:'エレキ',piano:'ピアノ',soft:'合成音・やわらかい',clear:'合成音・明るい',sine:'合成音・まるい'};
    const examples=r.evaluationRows.filter(row=>row.poolingEvidence?.some(e=>e.effectiveCount>0)).slice(0,3);
    for(const row of examples){line('固定共有の根拠例：'+new Date(row.predictedAt).toLocaleString('ja-JP')+'・'+ReferencePolicy.labels[row.referencePermission]);for(const e of row.poolingEvidence.filter(e=>e.effectiveCount>0)){line((e.kind==='pair'?'隣接ペア':'コード')+' '+e.chords.map(chordLabel).join(' → ')+'：直接 '+e.direct.c+'/'+e.direct.n+'、借用 '+e.effectiveCount.toFixed(2)+'件相当、借用の影響 '+(100*e.influence).toFixed(1)+'%');for(const source of e.sources)line('↳ '+source.chords.map(chordLabel).join(' → ')+'・'+source.instrument+'・'+(axes[source.family]||source.family)+'：'+source.c+'/'+source.n+' × '+source.weight.toFixed(3));}}
    if(!examples.length)line('今回の評価問題では、固定設定で借用できる関連履歴がありませんでした。');
    line('初期の重み・上限と保留基準は仮の設計値です。履歴量だけで木の有用性は決まりません。今後の回答で直接履歴・固定共有・自動共有の誤差を継続比較してください。全回答のID・特徴量・モデル・比較設定はJSONに保存されます。');
  }
  paintCalibration(){
    const r=this.report;if(!r)return;const labels={...EarPrediction.modelLabels,...r.modelLabels};
    const calibration=document.getElementById('predictionCalibration');calibration.replaceChildren();
    const selector=document.getElementById('predictionCalibrationModel'),previous=selector.value,calibrationKeys=Object.keys(r.calibrations||{logistic:r.calibration});if(Array.from(selector.options,o=>o.value).join('|')!==calibrationKeys.join('|')){selector.replaceChildren();for(const key of calibrationKeys){const o=document.createElement('option');o.value=key;o.textContent=labels[key]||key;selector.append(o);}}selector.value=calibrationKeys.includes(previous)?previous:'logistic';
    for(const bin of r.calibrations?.[selector.value]||r.calibration){const tr=document.createElement('tr');for(const value of [`${Math.round(bin.lower*100)}〜${Math.round(bin.upper*100)}%`,bin.count,bin.count?(bin.meanPrediction*100).toFixed(1)+'%':'—',bin.count?(bin.accuracy*100).toFixed(1)+'%':'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}calibration.append(tr);}
  }
  export(){
    if(!this.report)return;
    const blob=new Blob([JSON.stringify(this.report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='ear-lab-prediction-'+this.report.createdAt.slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    document.getElementById('predictionMessage').textContent='実験結果・学習条件・使用した回答ID・各問題の予測を保存しました。';
  }
}
