export const NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
export const pc = n => ((n % 12) + 12) % 12;
export const noteName = n => NAMES[pc(n)] + (Math.floor(n / 12) - 1);
export const frequency = n => 440 * 2 ** ((n - 69) / 12);
export function endingNote(events, key) {
  const last = events.at(-1).midi;
  const target = pc(last) === key.root ? pc(key.root + (key.mode === 'minor' ? 3 : 4)) : key.root;
  return Array.from({length:6},(_,i)=>(i+3)*12+target).sort((a,b)=>Math.abs(a-last)-Math.abs(b-last))[0];
}
export function parseMelody(text) {
  const parts = text.trim().split(/[\s,]+/);
  if (!text.trim() || parts.length > 120) throw new Error('Enter between 1 and 120 notes.');
  return parts.map(part => {
    const m = /^([A-Ga-g])([#♯b♭]?)([0-7])$/.exec(part);
    if (!m) throw new Error(`“${part}” needs a note and octave, like A3 or C#4.`);
    const n = ({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[m[1].toUpperCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0) + (+m[3] + 1) * 12;
    if (n < 36 || n > 96) throw new Error('Use notes from C2 through C7 for this guitar workshop.');
    return n;
  });
}

// YIN difference function. Return null for quiet/noisy/aperiodic frames.
export function detectPitch(frame, rate) {
  let energy = 0;
  for (const sample of frame) energy += sample * sample;
  if (Math.sqrt(energy / frame.length) < .009) return null;
  const maxTau = Math.min(Math.floor(rate / 65), frame.length >> 1);
  const minTau = Math.floor(rate / 1000);
  const difference = new Float32Array(maxTau + 1);
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < frame.length - maxTau; i++) sum += (frame[i] - frame[i + tau]) ** 2;
    running += sum;
    difference[tau] = running ? sum * tau / running : 1;
  }
  for (let tau = minTau; tau < maxTau - 1; tau++) {
    if (difference[tau] < .16) {
      while (tau + 1 < maxTau && difference[tau + 1] < difference[tau]) tau++;
      const left = difference[tau - 1], mid = difference[tau], right = difference[tau + 1];
      const denominator = 2 * (2 * mid - right - left);
      const refined = denominator ? tau + (right - left) / denominator : tau;
      return { hz: rate / refined, confidence: 1 - mid };
    }
  }
  return null;
}

export function transcribe(samples, rate) {
  const hop = Math.round(rate * .04), size = 1024;
  const events = [];
  let current = null;
  for (let start = 0; start + size <= samples.length; start += hop) {
    const pitch = detectPitch(samples.subarray(start, start + size), rate);
    const midi = pitch ? Math.round(69 + 12 * Math.log2(pitch.hz / 440)) : null;
    const time = (start + size / 2) / rate;
    if (midi !== null && midi >= 36 && midi <= 96) {
      if (current && current.midi === midi && time - (current.start + current.duration) < .1) current.duration = time + hop / rate - current.start;
      else { current = { midi, start: time, duration: hop / rate }; events.push(current); }
    } else current = null;
  }
  return events.filter(e => e.duration >= .075).slice(0, 120);
}

export function analyzeHarmony(events) {
  if (!events.length) throw new Error('No melody notes found.');
  const histogram = new Array(12).fill(0);
  for (const event of events) histogram[pc(event.midi)] += event.duration;
  const profiles = { major: [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88], minor: [6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17] };
  const candidates = [];
  for (const mode of ['major','minor']) for (let root = 0; root < 12; root++) {
    const total = histogram.reduce((a,b) => a+b, 0);
    const mean = profiles[mode].reduce((a,b) => a+b, 0) / 12;
    let score = 0, normA = 0, normB = 0;
    for (let i = 0; i < 12; i++) {
      const a = histogram[i] - total / 12, b = profiles[mode][pc(i-root)] - mean;
      score += a*b; normA += a*a; normB += b*b;
    }
    score = normA ? score / Math.sqrt(normA * normB) : 0;
    candidates.push({root, mode, score});
  }
  candidates.sort((a,b) => b.score-a.score);
  const key = candidates[0];
  const minor = key.mode === 'minor';
  const recipes = minor ? [ [[0,1],[8,0],[3,0],[10,0]], [[3,0],[10,0],[8,0],[0,1]], [[5,1],[8,0],[10,0],[0,1]] ] : [ [[0,0],[9,1],[5,0],[7,0]], [[9,1],[5,0],[0,0],[7,0]], [[2,1],[5,0],[7,0],[0,0]] ];
  const directions = recipes.map((recipe, index) => ({
    id: index,
    title: ['Find your footing.', 'Change the scenery.', 'Leave a door open.'][index],
    label: ['A / THE FAMILIAR','B / A DIFFERENT LIGHT','C / A LITTLE TENSION'][index],
    description: ['Start with a clear home, then let the bass move beneath your melody.', 'Begin on a different chord to shift the emotional center of the same riff.', 'Start away from home and let the last chord bring the phrase back.'][index],
    chords: recipe.map(([offset, isMinor]) => {
      const root = pc(key.root + offset), tones = [root, pc(root + (isMinor ? 3 : 4)), pc(root + 7)];
      return {root, minor: !!isMinor, name: NAMES[root] + (isMinor ? 'm' : ''), tones, shared: tones.filter(n => histogram[n] > 0).map(n => NAMES[n])};
    })
  }));
  return { key, alternative: candidates[1], directions, unique: histogram.filter(x => x > 0).length };
}

export const demoEvents = [57,60,64,67,64,60,59,57].map((midi,i) => ({midi,start:i*.48,duration:.38}));
