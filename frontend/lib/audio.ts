/** Mic capture: 16 kHz Int16 PCM frames for whisper + volume and pitch for tone metrics. */

export type AudioFrame = { pcm: ArrayBuffer; rms: number; pitch: number | null };

export async function startAudio(stream: MediaStream, onFrame: (f: AudioFrame) => void) {
  // Ask the browser for 16 kHz directly: its resampler low-pass filters properly, so the
  // worklet's ratio is 1 and no aliasing reaches Whisper. Falls back to the device rate.
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
  } catch {
    ctx = new AudioContext();
  }
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-worklet");
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const buf = new Float32Array(analyser.fftSize);
  src.connect(node);
  src.connect(analyser);
  node.port.onmessage = (e) => {
    analyser.getFloatTimeDomainData(buf);
    onFrame({ pcm: e.data.pcm, rms: e.data.rms, pitch: e.data.rms > 0.01 ? autocorrelatePitch(buf, ctx.sampleRate) : null });
  };
  return () => {
    node.port.onmessage = null;
    src.disconnect();
    ctx.close();
  };
}

/** Simple autocorrelation pitch estimate in the human voice range (75–400 Hz). */
export function autocorrelatePitch(buf: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 75);
  let best = -1;
  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < buf.length; i++) sum += buf[i] * buf[i + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
  if (bestLag < 0 || best < energy * 0.3) return null; // unvoiced / noise
  return sampleRate / bestLag;
}
