// AudioWorklet: downmix to mono, resample to 16 kHz, emit Int16 PCM frames (~100 ms)
// plus RMS so the page can show a volume meter. Runs off the main thread.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.buf = [];
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch[0]) return true;
    const n = ch[0].length;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch.length; c++) for (let i = 0; i < n; i++) mono[i] += ch[c][i] / ch.length;
    while (this.pos < n) {
      this.buf.push(mono[Math.floor(this.pos)]);
      this.pos += this.ratio;
    }
    this.pos -= n;
    if (this.buf.length >= 1600) {
      const pcm = new Int16Array(this.buf.length);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const s = Math.max(-1, Math.min(1, this.buf[i]));
        pcm[i] = s * 0x7fff;
        sum += s * s;
      }
      this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(sum / this.buf.length) }, [pcm.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor("pcm-worklet", PcmWorklet);
