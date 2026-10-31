'use strict';
// Standard tuning, strings 6 to 1. null denotes an unplayed string.
// Open shapes where practical; E- or A-form barre shapes for the rest.
const GuitarVoicings = (() => {
  const tuning = [40,45,50,55,59,64];
  const shapes = {
    0: [[null,3,2,0,1,0],[null,3,5,5,4,3],[null,3,5,3,5,3],[null,3,2,0,0,0]],
    2: [[null,null,0,2,3,2],[null,null,0,2,3,1],[null,null,0,2,1,2],[null,null,0,2,2,2]],
    4: [[0,2,2,1,0,0],[0,2,2,0,0,0],[0,2,0,1,0,0],[0,2,1,1,0,0]],
    5: [[1,3,3,2,1,1],[1,3,3,1,1,1],[1,3,1,2,1,1],[1,3,2,2,1,1]],
    7: [[3,2,0,0,0,3],[3,5,5,3,3,3],[3,2,0,0,0,1],[3,2,0,0,0,2]],
    9: [[null,0,2,2,2,0],[null,0,2,2,1,0],[null,0,2,0,2,0],[null,0,2,1,2,0]],
    11:[[null,2,4,4,4,2],[null,2,4,4,3,2],[null,2,4,2,4,2],[null,2,4,3,4,2]]
  };
  function strings(rootMidi, quality) {
    const pc=((rootMidi%12)+12)%12;
    const fret=(pc-9+12)%12;
    let frets = quality===4?[null,fret,fret+1,fret+2,fret+1,null]:shapes[pc]?.[quality];
    if(!frets&&quality>=0&&quality<4){
      const eShift=(pc-4+12)%12,aShift=(pc-9+12)%12;
      const base=eShift<=aShift?shapes[4][quality]:shapes[9][quality],shift=Math.min(eShift,aShift);
      frets=base.map(f=>f===null?null:f+shift);
    }
    if (!frets) throw new Error('このコードのギターの押さえ方は未登録です。');
    return frets.map((fret,index) => ({ string:6-index, fret, midi:fret === null ? null : tuning[index]+fret }));
  }
  return {
    strings,
    notes: (rootMidi, quality) => strings(rootMidi, quality).filter(s => s.midi !== null).map(s => s.midi)
  };
})();
