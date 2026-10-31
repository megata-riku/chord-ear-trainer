'use strict';
const FeedbackFlow = {
  normalize(value) {
    return {
      mode:['auto','wrongStop','manual'].includes(value?.mode)?value.mode:'auto',
      delayMs:[700,1200,2000].includes(Number(value?.delayMs))?Number(value.delayMs):700,
      showNextButton:value?.showNextButton===true
    };
  },
  shouldReview(mode, correct) { return mode==='manual' || (mode==='wrongStop' && !correct); }
};
class FeedbackClock {
  constructor(timers={set:(callback,delay)=>setTimeout(callback,delay),clear:timer=>clearTimeout(timer)}) { this.timers=timers;this.generation=0;this.timer=null; }
  cancel() { this.generation++;if(this.timer!==null)this.timers.clear(this.timer);this.timer=null; }
  schedule(callback, delay) {
    this.cancel();const generation=this.generation;
    this.timer=this.timers.set(()=>{if(this.generation!==generation)return;this.timer=null;callback();},delay);
  }
}
