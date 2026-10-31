'use strict';
// Local MP3 samples; no third-party code is evaluated in the browser.
class InstrumentSamples {
  constructor() {
    this.cache = new Map();
  }
  supports(instrument) { return instrument === 'piano' || instrument === 'guitar' || instrument === 'electric'; }
  async load(context, instrument, midi) {
    if (!this.supports(instrument) || !Number.isInteger(midi) || midi < (instrument === 'piano' ? 48 : 40) || midi > 94) {
      throw new Error('この音域の楽器音源は用意されていません。');
    }
    const key = instrument + '/' + midi;
    if (!this.cache.has(key)) {
      const promise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch('audio/' + key + '.mp3', { signal: controller.signal });
          if (!response.ok) throw new Error('音源を取得できませんでした。');
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          // Match note peaks so changing pitch does not produce a sudden level jump.
          let peak = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
          }
          if (!Number.isFinite(peak) || peak < 0.0001) throw new Error('音源に音がありません。');
          return { buffer, gain: Math.min(8, 0.9 / peak) };
        } catch (error) {
          this.cache.delete(key);
          throw new Error('楽器の音源を読み込めませんでした。通信を確認し、もう一度再生してください。');
        } finally { clearTimeout(timer); }
      })();
      this.cache.set(key, promise);
    }
    return this.cache.get(key);
  }
  async prepare(context, instrument, notes) {
    const unique = [...new Set(notes)];
    return new Map(await Promise.all(unique.map(async midi => [midi, await this.load(context, instrument, midi)])));
  }
  schedule(context, destination, sample, at, length, level, track) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = sample.buffer;
    const duration = Math.min(length, sample.buffer.duration);
    const release = Math.min(0.065, duration / 3);
    const peak = level * sample.gain;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + Math.min(0.004, duration / 6));
    gain.gain.setValueAtTime(peak, at + duration - release);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source.connect(gain);
    gain.connect(destination);
    source.start(at);
    source.stop(at + duration + 0.01);
    track(source, gain);
  }
}
