const STRINGS = [
  { midi: 40, name: "E2" },
  { midi: 45, name: "A2" },
  { midi: 50, name: "D3" },
  { midi: 55, name: "G3" },
  { midi: 59, name: "B3" },
  { midi: 64, name: "E4" },
];
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function estimateStrings(spectrum, sampleRate, fftSize) {
  const binHz = sampleRate / fftSize;
  const amplitudes = Float32Array.from(spectrum, (db) =>
    Number.isFinite(db) ? 10 ** (db / 20) : 0,
  );
  const magAt = (hz) => {
    const bin = hz / binHz;
    if (bin < 1 || bin >= amplitudes.length - 1) return 0;
    const low = Math.floor(bin);
    const frac = bin - low;
    return amplitudes[low] * (1 - frac) + amplitudes[low + 1] * frac;
  };
  const result = STRINGS.map((string) => {
    const target = 440 * 2 ** ((string.midi - 69) / 12);
    let best = null;
    for (let cents = -300; cents <= 300; cents += 3) {
      const hz = target * 2 ** (cents / 1200);
      const fundamental = magAt(hz);
      let score = fundamental * 1.8;
      for (let harmonic = 2; harmonic <= 5; harmonic++)
        score += magAt(hz * harmonic) / harmonic;
      if (!best || score > best.score) best = { hz, score, fundamental, target };
    }
    if (!best || best.fundamental < 0.00006 || best.score < 0.00018) return null;
    const cents = Math.round(1200 * Math.log2(best.hz / best.target));
    const midi = Math.round(69 + 12 * Math.log2(best.hz / 440));
    const note = NOTE_NAMES[(midi % 12 + 12) % 12] + (Math.floor(midi / 12) - 1);
    return { string: string.name, note, cents, frequency: best.hz };
  });
  return result;
}

export { STRINGS };
