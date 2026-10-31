'use strict';
const $=id=>document.getElementById(id);
const types=[{id:'major',suffix:'',label:'メジャー',ints:[0,4,7],degrees:['根音','長3度','完全5度']},{id:'minor',suffix:'m',label:'マイナー',ints:[0,3,7],degrees:['根音','短3度','完全5度']},{id:'seven',suffix:'7',label:'ドミナント7th',ints:[0,4,7,10],degrees:['根音','長3度','完全5度','短7度']},{id:'majseven',suffix:'maj7',label:'メジャー7th',ints:[0,4,7,11],degrees:['根音','長3度','完全5度','長7度']},{id:'diminished',suffix:'dim',label:'ディミニッシュ',ints:[0,3,6],degrees:['根音','短3度','減5度']}];
let activeKey=null;
const setActiveKey=key=>{activeKey=key||null;};
let chosen=0,ctx,master,voices=[],endTimer,run=0;
const samples = new InstrumentSamples();
const root=()=>Number($('root').value)+Number($('octave').value);
const name=n=>MusicTheory.noteName(n,activeKey,Number($('root').value),chosen);
const full=n=>MusicTheory.fullNoteName(n,activeKey,Number($('root').value),chosen);
const titleFor=(midi,i,keyId=activeKey)=>MusicTheory.chordName(midi,i,keyId);
const title=i=>titleFor(Number($('root').value),i);
const isGuitar=()=>['guitar','electric'].includes($('timbre').value);
const notesFor=(midi,i)=>isGuitar()?GuitarVoicings.notes(midi,i):types[i].ints.map(n=>midi+Number($('octave').value)+n);
const pitches=i=>notesFor(Number($('root').value),i);
const strumSpan=notes=>isGuitar()&&$('guitarStyle').value==='strum'?(notes.length-1)*.028:0;
const uniqueClasses=notes=>notes.filter((n,i)=>notes.findIndex(m=>m%12===n%12)===i);
const degreeLabel=n=>types[chosen].degrees[types[chosen].ints.indexOf((n-root()+120)%12)]||'';
function status(s){$('status').textContent=s;}
function stop(quiet=false){run++;clearTimeout(endTimer);for(const v of voices){try{v.stop();}catch{}}voices=[];if(!quiet)status('停止しました。');}
async function ready(){if(!ctx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('このブラウザでは音の再生を利用できません。');ctx=new AC();master=ctx.createGain();master.gain.value=Number($('volume').value)/100;master.connect(ctx.destination);}await ctx.resume();if(ctx.state!=='running')throw new Error('再生を開始できません。もう一度ボタンを押してください。');}
function tone(midi,at,len,level){const mode=$('timbre').value;const partials=mode==='soft'?[[1,1],[2,.20],[3,.07]]:mode==='clear'?[[1,1],[2,.4],[3,.22],[4,.09]]:[[1,1]];const sum=partials.reduce((a,x)=>a+x[1],0);for(const [multiple,weight]of partials){const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=440*2**((midi-69)/12)*multiple;const peak=level*weight/sum;g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(peak,at+.015);g.gain.exponentialRampToValueAtTime(Math.max(.00001,peak*(mode==='sine'?.65:.22)),at+len*.8);g.gain.linearRampToValueAtTime(0,at+len);o.connect(g);g.connect(master);o.start(at);o.stop(at+len+.03);voices.push(o);o.onended=()=>{o.disconnect();g.disconnect();voices=voices.filter(v=>v!==o);};}}
function trackSample(source, gain) {
  voices.push(source);
  source.onended = () => {
    source.disconnect(); gain.disconnect();
    voices = voices.filter(v => v !== source);
  };
}
async function play(events,label) {
  stop(true);
  const token = run;
  const instrument = $('timbre').value;
  try {
    await ready();
    if (token !== run) return;
    let prepared;
    if (samples.supports(instrument)) {
      status(instrumentLabel(instrument) + 'の音源を準備中…');
      prepared = await samples.prepare(ctx, instrument, events.flatMap(e => e.notes));
      if (token !== run) return;
    }
    const at = ctx.currentTime + .04;
    for (const e of events) {
      const level = .65 / Math.max(1, e.notes.length);
      e.notes.forEach((n, index) => {
        const offset = instrument === 'guitar' || instrument === 'electric'
          ? ($('guitarStyle').value === 'strum' ? index * .028 : 0) : 0;
        if (prepared) samples.schedule(ctx, master, prepared.get(n), at + e.t + offset, e.len, level, trackSample);
        else tone(n, at + e.t, e.len, level);
      });
    }
    status(instrumentLabel(instrument) + ' · ' + label);
    const end = Math.max(...events.map(e => e.t + e.len + strumSpan(e.notes)));
    endTimer = setTimeout(() => {
      if (run === token) status('再生が終わりました。何度でも聴き直せます。');
    }, (end + .1) * 1000);
    return {startedAtMs:Date.now()+40, endAtMs:Date.now()+40+end*1000, playbackToken:run};
  } catch (error) {
    if (token === run) { stop(true); status(error.message || '音を再生できませんでした。'); }
    return null;
  }
}
function chord(i){chosen=i;render();play([{notes:pitches(i),t:0,len:Number($('duration').value)}],title(i)+' を再生中');}
function arpeggio(){const len=Number($('duration').value);play(pitches(chosen).map((n,i)=>({notes:[n],t:i*.55,len:Math.min(len,.8)})),title(chosen)+' の構成音を低い方から再生中');}
function diff(){
  const a=Number($('a').value),b=Number($('b').value),aRoot=Number($('aRoot').value),bRoot=Number($('bRoot').value),aa=notesFor(aRoot,a),bb=notesFor(bRoot,b);
  // Chord identity compares pitch classes; register and duplicate strings are shown separately.
  return {a,b,aRoot,bRoot,aa,bb,
    onlyA:uniqueClasses(aa.filter(n=>!bb.some(m=>m%12===n%12))),
    onlyB:uniqueClasses(bb.filter(n=>!aa.some(m=>m%12===n%12))),
    common:uniqueClasses(aa.filter(n=>bb.some(m=>m%12===n%12)))};
}
function compare(){const d=diff(),len=Number($('duration').value),gap=Number($('gap').value);play([{notes:d.aa,t:0,len},{notes:d.bb,t:len+strumSpan(d.aa)+gap,len}],titleFor(d.aRoot,d.a)+' → '+titleFor(d.bRoot,d.b)+' を再生中');}

function renderDiff(){const d=diff();let text;if(!d.onlyA.length&&!d.onlyB.length)text='同じコードです。AとBを変えると、音の違いを確認できます。';else if(!d.onlyA.length)text=titleFor(d.bRoot,d.b)+'では、'+d.onlyB.map(n=>MusicTheory.noteName(n,activeKey,d.bRoot,d.b)).join('・')+'が加わります。';else if(!d.onlyB.length)text=titleFor(d.bRoot,d.b)+'では、'+d.onlyA.map(n=>MusicTheory.noteName(n,activeKey,d.aRoot,d.a)).join('・')+'がなくなります。';else text='Aの'+d.onlyA.map(n=>MusicTheory.noteName(n,activeKey,d.aRoot,d.a)).join('・')+'が、Bでは'+d.onlyB.map(n=>MusicTheory.noteName(n,activeKey,d.bRoot,d.b)).join('・')+'に変わります。';$('explanation').textContent=text;$('diffNotes').innerHTML=d.common.map(n=>'<span class="chip">共通 '+MusicTheory.noteName(n,activeKey,d.aRoot,d.a)+'</span>').join('')+d.onlyA.map(n=>'<span class="chip change">Aのみ '+MusicTheory.noteName(n,activeKey,d.aRoot,d.a)+'</span>').join('')+d.onlyB.map(n=>'<span class="chip change">Bのみ '+MusicTheory.noteName(n,activeKey,d.bRoot,d.b)+'</span>').join('');$('diffPlay').disabled=!d.onlyA.length&&!d.onlyB.length;}
function keyboard(){const ns=pitches(chosen),base=Math.floor(root()/12)*12;const white=[0,2,4,5,7,9,11,12,14,16,17,19,21,23];$('keyboard').innerHTML=white.map(n=>'<span class="key '+(ns.includes(base+n)?'marked':'')+'">'+(ns.includes(base+n)?name(base+n):'')+'</span>').join('');const blacks=[1,3,6,8,10,13,15,18,20,22];for(const n of blacks){const before=white.filter(w=>w<n).length;const k=document.createElement('span');k.className='key black '+(ns.includes(base+n)?'marked':'');k.style.left=(before/14*100-2.7)+'%';k.textContent=ns.includes(base+n)?name(base+n):'';$('keyboard').append(k);}}
function renderComparisonOptions(){
  for(const id of ['a','b']){
    const quality=$(id).value||(id==='a'?'0':'2');
    const rootValue=$(id+'Root').value||$('root').value;
    $(id+'Root').innerHTML=Array.from({length:12},(_,i)=>60+i).map(n=>'<option value="'+n+'">'+MusicTheory.rootName(n,activeKey)+'</option>').join('');
    $(id+'Root').value=rootValue;
    $(id).innerHTML=types.map((t,i)=>'<option value="'+i+'">'+titleFor(Number(rootValue),i)+'</option>').join('');
    $(id).value=quality;
  }
}
function render(){const oldA=$('a').value||'0',oldB=$('b').value||'2';$('chords').innerHTML=types.slice(0,4).map((t,i)=>'<button class="chord '+(chosen===i?'active':'')+'" aria-pressed="'+(chosen===i)+'" data-chord="'+i+'"><span class="quality">'+t.label+'</span><span class="playicon">▶</span><strong>'+title(i)+'</strong><span class="pitch">'+uniqueClasses(pitches(i)).map(n=>MusicTheory.noteName(n,activeKey,Number($('root').value),i)).join(' · ')+(isGuitar()?' / '+pitches(i).length+'弦':'')+'</span></button>').join('');renderComparisonOptions();$('a').value=oldA;$('b').value=oldB;$('selectedName').textContent=title(chosen);$('formula').textContent=types[chosen].degrees.join(' ＋ ');if(isGuitar()){
    const strings=GuitarVoicings.strings(Number($('root').value),chosen);
    $('notes').innerHTML=strings.map(s=>s.midi===null
      ?'<span class="note mutedstring"><small>'+s.string+'弦</small>×<small>鳴らさない</small></span>'
      :'<button class="note" data-note="'+s.midi+'" aria-label="'+s.string+'弦 '+full(s.midi)+' を再生"><small>'+s.string+'弦 · '+(s.fret===0?'開放':s.fret+'F')+'</small>'+full(s.midi)+'<small>'+degreeLabel(s.midi)+'</small></button>').join('');
    $('voicingSummary').hidden=false;
    $('voicingSummary').textContent=title(chosen)+'：'+pitches(chosen).length+'本の弦 ／ '+types[chosen].ints.length+'種類の音。6弦→1弦の順に表示。';
    $('keyboard').hidden=true;
    $('noteHint').textContent='弦のボタンで1本ずつ確認できます。×の弦は鳴らしません。';
  }else{
    $('notes').innerHTML=pitches(chosen).map(n=>'<button class="note" data-note="'+n+'" aria-label="'+full(n)+' を再生">'+full(n)+'<small>'+degreeLabel(n)+'</small></button>').join('');
    $('voicingSummary').hidden=true;
    $('keyboard').hidden=false;
    $('noteHint').textContent='音名のボタンを押すと、その音だけ聴けます。';
  }
  keyboard();renderDiff();}
$('chords').onclick=e=>{const b=e.target.closest('[data-chord]');if(b)chord(Number(b.dataset.chord));};$('notes').onclick=e=>{const b=e.target.closest('[data-note]');if(b)play([{notes:[Number(b.dataset.note)],t:0,len:Number($('duration').value)}],full(Number(b.dataset.note))+' を再生中');};
for(const id of ['root','octave','duration','gap','guitarStyle'])$(id).onchange=()=>{stop(true);render();updateTimbreHint();status('設定を変更しました。再生ボタンで聴いてみよう。');};for(const id of ['a','b','aRoot','bRoot'])$(id).onchange=()=>{stop(true);renderComparisonOptions();renderDiff();status('比較するコードを変更しました。');};$('playPair').onclick=compare;$('arp').onclick=arpeggio;$('stop').onclick=()=>stop();$('swap').onclick=()=>{stop(true);const a=$('a').value;$('a').value=$('b').value;$('b').value=a;const ar=$('aRoot').value;$('aRoot').value=$('bRoot').value;$('bRoot').value=ar;renderComparisonOptions();renderDiff();status('AとBを入れ替えました。');};$('diffPlay').onclick=()=>{const d=diff(),notes=[...d.onlyA,...d.onlyB];if(notes.length)play(notes.map((n,i)=>({notes:[n],t:i*.9,len:.7})),'違う音を Aのみ → Bのみ の順で再生中');};$('volume').oninput=()=>{if(master)master.gain.setTargetAtTime(Number($('volume').value)/100,ctx.currentTime,.03);};document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});render();

function instrumentLabel(instrument) {
  return ({piano:'ピアノ', guitar:'アコースティックギター', electric:'エレキギター（クリーン）'})[instrument] || '合成音';
}
function updateTimbreHint() {
  const instrument = $('timbre').value;
  const text = instrument === 'piano'
    ? 'ピアノの音で再生します。初回は音源の読み込みに少し時間がかかります。'
    : instrument === 'guitar'
      ? 'アコースティックギター：実際に押さえられる4〜6弦の形で再生します。弾き方も選べます。'
      : instrument === 'electric'
        ? 'エレキギター（クリーン）：実際に押さえられる4〜6弦の形で再生します。弾き方も選べます。'
        : 'シンプルな合成音で再生します。下の設定で響きを選べます。';
  $('timbreHint').textContent = text;
  const isSynth = !samples.supports(instrument);
  $('synthSettings').hidden = !isSynth;
  $('guitarSettings').hidden = !isGuitar();
  $('octave').disabled = isGuitar();
  $('octave').title = isGuitar() ? 'ギターは押さえ方に応じた実音域で再生します' : ''; 
  document.querySelectorAll('[data-instrument]').forEach(button => {
    const active = button.dataset.instrument === instrument || (button.dataset.instrument === 'synth' && isSynth);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
document.querySelectorAll('[data-instrument]').forEach(button => {
  button.onclick = () => {
    $('timbre').value = button.dataset.instrument === 'synth' ? $('synthTone').value : button.dataset.instrument;
    updateTimbreHint();
    chord(chosen);
  };
});
$('synthTone').onchange = () => {
  $('timbre').value = $('synthTone').value;
  updateTimbreHint();
  chord(chosen);
};
updateTimbreHint();
