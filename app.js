import {
  noteName,
  frequency,
  parseMelody,
  analyzeHarmony,
  demoEvents,
  NAMES,
  endingNote,
} from "./music.js";
import { listSketches, writeSketch, deleteSketch } from "./storage.js";
import { estimateStrings, STRINGS } from "./tuner.js";

const $ = (id) => document.getElementById(id);
const state = {
  id: crypto.randomUUID(),
  events: [],
  blob: null,
  buffer: null,
  favorites: [],
  duration: 0,
  harmony: null,
};
let context,
  recorder,
  stream,
  timer,
  recording = false,
  busy = false,
  playback = [],
  playTimer,
  saveTimer,
  analysisId = 0,
  saving = Promise.resolve();
let inputAnalyser,
  inputSource,
  inputGain,
  limiter,
  monitorGain,
  meterFrame,
  recordingStream,
  micChecking = false;
let tunerContext, tunerStream, tunerAnalyser, tunerFrame;
let tunerHeld = [],
  tunerSamples = [];
const worker = new Worker("./analysis-worker.js", { type: "module" });
const pending = new Map();
worker.onmessage = ({ data }) => {
  const request = pending.get(data.id);
  if (request) {
    pending.delete(data.id);
    data.error
      ? request.reject(new Error(data.error))
      : request.resolve(data.events);
  }
};
worker.onerror = () => {
  for (const request of pending.values())
    request.reject(
      new Error(
        "Audio analysis could not start. Reload the app and try again.",
      ),
    );
  pending.clear();
};
function message(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function audio() {
  context ||= new (window.AudioContext || window.webkitAudioContext)();
  if (context.state !== "running") await context.resume();
  return context;
}
function setBusy(value) {
  busy = value;
  for (const id of [
    "record",
    "demo",
    "audio-file",
    "project-file",
    "new-sketch",
    "rethink",
    "variation",
    "play-riff",
    "library-tab",
    "tuner-tab",
    "mic-check",
    "input-gain",
    "hear-mic",
  ])
    $(id).disabled = value;
  $("play-riff").disabled = value || !state.buffer;
  document
    .querySelectorAll(".audition,.favorite")
    .forEach((b) => (b.disabled = value));
}
function stopPlayback() {
  for (const source of playback) {
    try {
      source.stop();
    } catch {}
  }
  playback = [];
  clearTimeout(playTimer);
  $("play-riff").textContent = "▶";
  $("play-riff").setAttribute("aria-label", "Play original riff");
  document.querySelectorAll(".audition").forEach((b) => {
    b.textContent = "▶ Hear with my riff";
    delete b.dataset.playing;
  });
}
function tone(ctx, midi, start, length, level = 0.09) {
  const osc = ctx.createOscillator(),
    gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = frequency(midi);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, start + Math.max(0.04, length));
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.06);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  playback.push(osc);
}
function original(ctx, start) {
  if (!state.buffer) return;
  const source = ctx.createBufferSource(),
    gain = ctx.createGain();
  source.buffer = state.buffer;
  gain.gain.value = 0.8;
  source.connect(gain).connect(ctx.destination);
  source.start(start);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  playback.push(source);
}
async function playRiff() {
  const wasPlaying = playback.length > 0;
  stopPlayback();
  if (wasPlaying) return;
  try {
    const ctx = await audio();
    original(ctx, ctx.currentTime + 0.05);
    $("play-riff").textContent = "■";
    $("play-riff").setAttribute("aria-label", "Stop playback");
    playTimer = setTimeout(stopPlayback, (state.duration + 0.15) * 1000);
  } catch (error) {
    message(error.message, true);
  }
}
async function audition(direction, button) {
  const wasPlaying = button.dataset.playing === "true";
  document
    .querySelectorAll(".audition")
    .forEach((b) => delete b.dataset.playing);
  stopPlayback();
  if (wasPlaying) return;
  try {
    const ctx = await audio(),
      start = ctx.currentTime + 0.08,
      duration = Math.max(2, state.duration),
      bar = duration / 4;
    original(ctx, start);
    direction.chords.forEach((chord, i) => {
      tone(ctx, chord.root + 36, start + i * bar, bar * 0.92, 0.09);
      chord.tones.forEach((n, j) =>
        tone(ctx, n + 48, start + i * bar + j * 0.035, bar * 0.88, 0.045),
      );
    });
    button.textContent = "■ Stop audition";
    button.dataset.playing = "true";
    playTimer = setTimeout(
      () => {
        stopPlayback();
        delete button.dataset.playing;
      },
      (duration + 0.2) * 1000,
    );
  } catch (error) {
    message(error.message, true);
  }
}
function drawWave(buffer) {
  const canvas = $("waveform"),
    ctx = canvas.getContext("2d"),
    width = canvas.width,
    height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const data = buffer?.getChannelData(0);
  let maxPeak = 0;
  if (data)
    for (const sample of data) maxPeak = Math.max(maxPeak, Math.abs(sample));
  // Normalize the display independently from playback gain: even a very quiet
  // recording should have a visible shape if the mic captured anything.
  const displayGain = data && maxPeak > 0 ? Math.min(1000, 0.85 / maxPeak) : 1;
  ctx.strokeStyle = "#a4b494";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let x = 4; x < width; x += 7) {
    let peak = 0;
    if (data) {
      const start = Math.floor((x / width) * data.length),
        end = Math.min(
          data.length,
          start + Math.ceil((data.length / width) * 7),
        );
      for (let i = start; i < end; i++)
        peak = Math.max(peak, Math.abs(data[i]));
    } else
      peak =
        0.018 +
        0.05 *
          (0.5 + 0.5 * Math.sin(x * 0.051)) *
          (0.5 + 0.5 * Math.sin(x * 0.017));
    const h = Math.max(2, peak * displayGain * height * 0.48);
    ctx.beginPath();
    ctx.moveTo(x, height / 2 - h / 2);
    ctx.lineTo(x, height / 2 + h / 2);
    ctx.stroke();
  }
}
function startInputMeter() {
  const canvas = $("waveform"),
    ctx = canvas.getContext("2d"),
    samples = new Float32Array(inputAnalyser.fftSize);
  const draw = () => {
    if ((!recording && !micChecking) || !inputAnalyser) return;
    inputAnalyser.getFloatTimeDomainData(samples);
    let peak = 0,
      energy = 0;
    for (const sample of samples) {
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / samples.length);
    const db = rms > 0 ? Math.round(20 * Math.log10(rms)) : -100;
    const level = Math.max(0, Math.min(1, (db + 60) / 54));
    $("input-level-bar").style.width = `${Math.round(level * 100)}%`;
    $("input-level-bar").style.background =
      peak > 0.96 ? "#b84936" : level < 0.2 ? "#c18c48" : "#61805c";
    $("input-level-value").textContent =
      peak > 0.96 ? "CLIPPING" : rms === 0 ? "NO INPUT" : `${db} dBFS`;
    $("input-level-label").textContent =
      rms === 0
        ? "No mic signal detected"
        : level < 0.2
          ? "Very quiet · raise input gain"
          : "Guitar signal detected";

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = peak > 0.96 ? "#b84936" : "#61805c";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const displayGain = peak > 0 ? Math.min(1000, 0.85 / peak) : 1;
    for (let x = 0; x < width; x++) {
      const sample = samples[Math.floor((x / width) * samples.length)] || 0;
      const y = height / 2 - sample * displayGain * height * 0.46;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    meterFrame = requestAnimationFrame(draw);
  };
  draw();
}
async function startMicInput() {
  await audio();
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Microphone access isn’t available in this browser.");
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  inputSource = context.createMediaStreamSource(stream);

  if (
    context.createMediaStreamDestination &&
    context.createDynamicsCompressor
  ) {
    const destination = context.createMediaStreamDestination();
    recordingStream = destination.stream;
    inputGain = context.createGain();
    inputAnalyser = context.createAnalyser();
    inputAnalyser.fftSize = 2048;
    limiter = context.createDynamicsCompressor();
    monitorGain = context.createGain();
    monitorGain.gain.value = $("hear-mic").checked ? 0.18 : 0;
    limiter.threshold.value = -10;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    inputSource.connect(inputGain).connect(inputAnalyser).connect(limiter);
    limiter.connect(destination);
    limiter.connect(monitorGain).connect(context.destination);
    inputGain.gain.value = 10 ** (+$("input-gain").value / 20);
  } else {
    recordingStream = stream;
    inputAnalyser = context.createAnalyser();
    inputAnalyser.fftSize = 2048;
    inputSource.connect(inputAnalyser);
    $("hear-mic").disabled = true;
  }
  $("hear-mic").disabled = !monitorGain;
  micChecking = true;
  $("mic-check").textContent = "Stop mic check";
  $("record-state").textContent = "Mic check · play a note and adjust the gain";
  startInputMeter();
}
function stopMicInput() {
  if (recording) return;
  micChecking = false;
  cancelAnimationFrame(meterFrame);
  try {
    inputSource?.disconnect();
  } catch {}
  try {
    inputGain?.disconnect();
  } catch {}
  try {
    limiter?.disconnect();
  } catch {}
  try {
    monitorGain?.disconnect();
  } catch {}
  stream?.getTracks().forEach((track) => track.stop());
  recordingStream?.getTracks().forEach((track) => track.stop());
  stream =
    recordingStream =
    inputAnalyser =
    inputSource =
    inputGain =
    limiter =
    monitorGain =
      null;
  $("hear-mic").checked = false;
  $("hear-mic").disabled = true;
  $("mic-check").textContent = "Check mic before recording";
  $("record-state").textContent = "Mic check stopped";
}
function durationText(seconds) {
  return `00:${String(Math.floor(seconds)).padStart(2, "0")}`;
}

function renderHarmony() {
  if (!state.events.length) {
    $("pitch-editor").hidden = true;
    $("next-step").hidden = true;
    return;
  }
  state.harmony = analyzeHarmony(state.events);
  const { key, alternative, unique, directions } = state.harmony;
  $("analysis-summary").replaceChildren(
    el("span", "tiny-star", "✳"),
    el(
      "p",
      "",
      `${NAMES[key.root]} ${key.mode} is one possible home. ${NAMES[alternative.root]} ${alternative.mode} is another. ${unique < 3 ? "With so few different notes, many harmonies can fit." : "Your melody can support more than one interpretation."} Try these by ear.`,
    ),
  );
  $("pitch-editor").hidden = false;
  $("melody").value = state.events.map((e) => noteName(e.midi)).join(" ");
  $("directions").replaceChildren();
  for (const direction of directions) {
    const card = el("article", "direction");
    card.append(
      el("span", "card-number", direction.label),
      el("h3", "", direction.title),
      el("p", "", direction.description),
    );
    const chords = el("div", "chords");
    for (const chord of direction.chords)
      chords.append(el("span", "chord", chord.name));
    card.append(chords);
    const actions = el("div", "card-actions"),
      listen = el(
        "button",
        "button secondary audition",
        "▶ Hear with my riff",
      ),
      favorite = el(
        "button",
        "favorite",
        state.favorites.includes(direction.id) ? "★" : "☆",
      );
    listen.onclick = () => audition(direction, listen);
    favorite.setAttribute("aria-label", `Save favorite: ${direction.title}`);
    favorite.setAttribute(
      "aria-pressed",
      String(state.favorites.includes(direction.id)),
    );
    favorite.classList.toggle(
      "selected",
      state.favorites.includes(direction.id),
    );
    favorite.onclick = () => {
      if (state.favorites.includes(direction.id))
        state.favorites = state.favorites.filter((id) => id !== direction.id);
      else state.favorites.push(direction.id);
      favorite.textContent = state.favorites.includes(direction.id) ? "★" : "☆";
      favorite.classList.toggle(
        "selected",
        state.favorites.includes(direction.id),
      );
      favorite.setAttribute(
        "aria-pressed",
        String(state.favorites.includes(direction.id)),
      );
      scheduleSave();
    };
    actions.append(listen, favorite);
    card.append(actions);
    const details = el("details");
    details.append(el("summary", "", "Why these chords?"));
    const explanation = el("div");
    for (const chord of direction.chords)
      explanation.append(
        el(
          "p",
          "",
          `${chord.name}: ${chord.tones.map((n) => NAMES[n]).join(" · ")}. ${chord.shared.length ? `Shares ${chord.shared.join(", ")} with your riff.` : "Adds notes outside your riff for contrast."}`,
        ),
      );
    explanation.append(
      el(
        "p",
        "",
        "These are starting points, not a transcription of an existing accompaniment. Each chord lasts a quarter of your clip; trim silence before importing for a tighter fit.",
      ),
    );
    details.append(explanation);
    card.append(details);
    $("directions").append(card);
  }
  $("next-step").hidden = false;
  $("development").textContent =
    `Repeat your phrase, then change just the final note to ${noteName(endingNote(state.events, key))}, a different note from the proposed home chord. How does that change the feeling? Keep the first ending for a verse, and try the new ending as a response. The preview uses a simple synthesized melody so you can hear the change.`;
  renderVariationTab();
}
function renderVariationTab() {
  const strings = [
    { name: "e", open: 64 },
    { name: "B", open: 59 },
    { name: "G", open: 55 },
    { name: "D", open: 50 },
    { name: "A", open: 45 },
    { name: "E", open: 40 },
  ];
  const events = state.events.map((event) => ({ ...event }));
  events[events.length - 1].midi = endingNote(events, state.harmony.key);
  const positions = events.map((event) => {
    let midi = event.midi;
    let octaveShift = 0;
    while (midi < 40) {
      midi += 12;
      octaveShift++;
    }
    while (midi > 86) {
      midi -= 12;
      octaveShift--;
    }
    return strings
      .map((string, index) => ({
        index,
        fret: midi - string.open,
        midi,
        octaveShift,
      }))
      .filter((choice) => choice.fret >= 0 && choice.fret <= 22)
      .sort((a, b) => a.fret - b.fret || a.index - b.index)[0];
  });
  const columns = positions.length * 5;
  $("tab-staff").textContent = strings
    .map((string, stringIndex) => {
      const row = Array(columns).fill("-");
      positions.forEach((position, noteIndex) => {
        if (position?.index !== stringIndex) return;
        const fret = String(position.fret);
        const offset = noteIndex * 5 + (fret.length === 2 ? 1 : 2);
        for (let i = 0; i < fret.length; i++) row[offset + i] = fret[i];
      });
      return `${string.name}|${row.join("")}|`;
    })
    .join("\n");
  const last = positions.at(-1);
  $("tab-ending").textContent = last
    ? `Ending: ${noteName(last.midi)} · ${strings[last.index].name} string, ${last.fret === 0 ? "open" : `fret ${last.fret}`}`
    : "Ending note outside this fretboard";
  $("tab-note").textContent = positions.some(
    (position) => position?.octaveShift,
  )
    ? "A note outside the usual guitar range is shown an octave higher or lower to fit a 22-fret guitar."
    : "0 means an open string. Standard tuning: E A D G B e.";
}
function getSketch() {
  return {
    version: 1,
    id: state.id,
    title: $("title").value.trim() || "Untitled riff",
    notes: $("notes").value,
    events: state.events.map((e) => ({ ...e })),
    favorites: [...state.favorites],
    blob: state.blob,
    duration: state.duration,
    updated: Date.now(),
  };
}
function saveSketch() {
  clearTimeout(saveTimer);
  const sketch = getSketch();
  $("save-state").textContent = "Saving…";
  saving = saving
    .catch(() => {})
    .then(() => writeSketch(sketch))
    .then(async () => {
      $("save-state").textContent = "Saved on this device";
      await updateCount();
    })
    .catch(() => {
      $("save-state").textContent = "Could not save";
      message(
        "Device storage could not save this sketch. Export it from My sketches if available, and free browser storage.",
        true,
      );
    });
  return saving;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  $("save-state").textContent = "Unsaved changes";
  saveTimer = setTimeout(saveSketch, 550);
}
async function updateCount() {
  try {
    $("sketch-count").textContent = (await listSketches()).length;
  } catch {
    message(
      "Local storage is unavailable. Your work may not survive a reload.",
      true,
    );
  }
}
function encodeWav(buffer) {
  const data = buffer.getChannelData(0),
    bytes = new ArrayBuffer(44 + data.length * 2),
    view = new DataView(bytes);
  const str = (offset, s) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + data.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++)
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return new Blob([bytes], { type: "audio/wav" });
}
async function acceptAudio(blob, isDemo = false, captureGainDb = 0) {
  setBusy(true);
  stopPlayback();
  message("Listening for the notes in your riff…");
  try {
    const ctx = await audio(),
      decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration < 0.2)
      throw new Error("That recording is too short. Try a few seconds.");
    const length = Math.min(
        decoded.length,
        Math.floor(decoded.sampleRate * 30),
      ),
      mono = ctx.createBuffer(1, length, decoded.sampleRate),
      out = mono.getChannelData(0);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const input = decoded.getChannelData(c);
      for (let i = 0; i < length; i++)
        out[i] += input[i] / decoded.numberOfChannels;
    }
    // iPad microphone input can be much quieter than its waveform suggests.
    // Boost the entire clip before both playback and pitch analysis, with ample
    // headroom and a hard limit so silence cannot generate unbounded gain.
    let peak = 0;
    for (const sample of out) peak = Math.max(peak, Math.abs(sample));
    const manualGain = 10 ** (captureGainDb / 20);
    const gain = peak > 0 ? Math.min(32, 0.75 / (peak * manualGain)) : 1;
    const totalGain = gain * manualGain;
    if (totalGain !== 1) {
      for (let i = 0; i < length; i++) out[i] *= totalGain;
    }
    const boostDb = Math.round(20 * Math.log10(totalGain));
    const offline = new OfflineAudioContext(
        1,
        Math.ceil(mono.duration * 8000),
        8000,
      ),
      source = offline.createBufferSource();
    source.buffer = mono;
    source.connect(offline.destination);
    source.start();
    const lowRate = await offline.startRendering(),
      samples = lowRate.getChannelData(0).slice();
    const events = isDemo
      ? demoEvents.map((e) => ({ ...e }))
      : await new Promise((resolve, reject) => {
          const id = ++analysisId;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, samples, rate: 8000 }, [samples.buffer]);
        });
    state.buffer = mono;
    state.blob = encodeWav(mono);
    state.duration = mono.duration;
    state.events = events;
    state.favorites = [];
    drawWave(mono);
    $("duration").textContent = durationText(state.duration);
    $("record-state").textContent = isDemo
      ? "A little A minor idea"
      : "Your riff, ready to explore";
    if (events.length) {
      renderHarmony();
      message(
        `${isDemo ? "Demo ready." : `Boosted the recording ${boostDb} dB. Found ${events.length} note events.`} Audition a direction below, or correct the detected melody.${decoded.duration > 30 ? " Only the first 30 seconds were used." : ""}`,
      );
    } else {
      $("analysis-summary").replaceChildren(
        el(
          "p",
          "",
          `We boosted this recording ${boostDb} dB, but still couldn’t confidently hear a melody. Try playing one note at a time closer to the iPad, or enter the notes below.`,
        ),
      );
      $("directions").replaceChildren();
      $("pitch-editor").hidden = false;
      $("melody").value = "";
      $("next-step").hidden = true;
      message(
        "Recording saved, but no clear notes were found. You can enter notes manually to explore harmony.",
        true,
      );
    }
    await saveSketch();
  } catch (error) {
    message(`Couldn’t analyze that audio. ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function toggleRecord() {
  if (recording) {
    recorder.stop();
    return;
  }
  if (busy) return;
  stopPlayback();
  setBusy(true);
  try {
    await audio();
    if (!window.MediaRecorder)
      throw new Error(
        "Microphone recording is unavailable in this browser. Try importing an audio file.",
      );
    if (!stream?.active) await startMicInput();
    micChecking = false;
    $("mic-check").textContent = "Mic ready · recording";
    // Keep the recorder connected directly to the original mic stream. The
    // Web Audio path is only for preview/monitoring; recording a generated
    // MediaStreamDestination is unreliable in some mobile browsers.
    recorder = new MediaRecorder(stream);
    const captureGainDb = +$("input-gain").value;
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const clean = () => {
      recording = false;
      micChecking = false;
      clearInterval(timer);
      cancelAnimationFrame(meterFrame);
      inputSource?.disconnect();
      try {
        inputGain?.disconnect();
      } catch {}
      try {
        limiter?.disconnect();
      } catch {}
      try {
        monitorGain?.disconnect();
      } catch {}
      inputAnalyser = inputSource = inputGain = limiter = monitorGain = null;
      stream?.getTracks().forEach((track) => track.stop());
      recordingStream?.getTracks().forEach((track) => track.stop());
      stream = recordingStream = null;
      $("hear-mic").checked = false;
      $("hear-mic").disabled = true;
      $("mic-check").textContent = "Check mic before recording";
      $("record").classList.remove("recording");
      $("record").innerHTML = '<span class="record-dot"></span> Record a riff';
    };
    recorder.onstop = async () => {
      clean();
      await acceptAudio(
        new Blob(chunks, { type: recorder.mimeType }),
        false,
        captureGainDb,
      );
    };
    recorder.onerror = () => {
      clean();
      setBusy(false);
      message("Recording was interrupted. Please try again.", true);
    };
    recorder.start();
    recording = true;
    startInputMeter();
    $("record").disabled = false;
    $("record").classList.add("recording");
    $("record").textContent = "■ Finish recording";
    $("record-state").textContent = "Listening… follow your ear";
    const started = Date.now();
    timer = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      $("duration").textContent = durationText(elapsed);
      if (elapsed >= 30 && recorder.state === "recording") recorder.stop();
    }, 200);
    message("Recording. Play a single-note phrase, then tap Finish recording.");
  } catch (error) {
    stopMicInput();
    setBusy(false);
    message(
      error.name === "NotAllowedError"
        ? "Microphone permission was denied. Enable it in browser settings, or import an audio file."
        : error.message,
      true,
    );
  }
}
async function loadDemo() {
  if (busy) return;
  setBusy(true);
  try {
    const ctx = await audio(),
      buffer = ctx.createBuffer(
        1,
        Math.ceil(4.2 * ctx.sampleRate),
        ctx.sampleRate,
      ),
      data = buffer.getChannelData(0);
    for (const event of demoEvents) {
      const first = Math.floor(event.start * ctx.sampleRate);
      for (let i = 0; i < event.duration * ctx.sampleRate; i++) {
        const t = i / ctx.sampleRate,
          envelope = Math.min(1, t / 0.008) * Math.exp(-t * 7);
        data[first + i] =
          envelope *
          (0.36 * Math.sin(2 * Math.PI * frequency(event.midi) * t) +
            0.1 * Math.sin(4 * Math.PI * frequency(event.midi) * t));
      }
    }
    await acceptAudio(encodeWav(buffer), true);
  } catch (error) {
    message(error.message, true);
    setBusy(false);
  }
}
function switchTab(library) {
  const view =
    library === true ? "library" : library === false ? "workbench" : library;
  if (view !== "tuner") stopTuner();
  $("workbench").hidden = view !== "workbench";
  $("library").hidden = view !== "library";
  $("tuner").hidden = view !== "tuner";
  for (const [id, selected] of [
    ["workbench-tab", view === "workbench"],
    ["library-tab", view === "library"],
    ["tuner-tab", view === "tuner"],
  ]) {
    $(id).classList.toggle("active", selected);
    $(id).setAttribute("aria-selected", String(selected));
  }
}
async function renderLibrary() {
  await saving;
  try {
    const sketches = (await listSketches()).sort(
      (a, b) => b.updated - a.updated,
    );
    $("sketches").replaceChildren();
    if (!sketches.length) {
      const empty = el("div", "empty-library");
      empty.append(
        el("h3", "", "A shelf for your next good idea."),
        el(
          "p",
          "",
          "Record a riff or try the demo to start your first sketch.",
        ),
      );
      $("sketches").append(empty);
    }
    for (const sketch of sketches) {
      const card = el("article", "sketch-card");
      card.append(
        el(
          "span",
          "card-number",
          new Date(sketch.updated).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        ),
        el("h3", "", sketch.title),
        el(
          "p",
          "",
          sketch.notes.slice(0, 180) ||
            `${sketch.events.length} notes · ${sketch.favorites.length} favorite directions`,
        ),
      );
      const actions = el("div", "actions");
      for (const [text, handler] of [
        ["Open", () => openSketch(sketch)],
        ["Export", () => exportSketch(sketch)],
        [
          "Delete",
          async () => {
            if (confirm(`Delete “${sketch.title}” from this device?`)) {
              await deleteSketch(sketch.id);
              if (sketch.id === state.id) state.id = crypto.randomUUID();
              await updateCount();
              await renderLibrary();
            }
          },
        ],
      ]) {
        const button = el("button", "text-button", text);
        button.onclick = () =>
          Promise.resolve(handler()).catch((error) =>
            message(error.message, true),
          );
        actions.append(button);
      }
      card.append(actions);
      $("sketches").append(card);
    }
  } catch {
    message(
      "Couldn’t read saved sketches. Your browser may be blocking local storage.",
      true,
    );
  }
}
async function openSketch(sketch) {
  stopPlayback();
  setBusy(true);
  try {
    const buffer = sketch.blob
      ? await (await audio()).decodeAudioData(await sketch.blob.arrayBuffer())
      : null;
    Object.assign(state, {
      id: sketch.id,
      events: sketch.events,
      favorites: sketch.favorites,
      blob: sketch.blob,
      buffer,
      duration: sketch.duration,
    });
    $("title").value = sketch.title;
    $("notes").value = sketch.notes;
    drawWave(buffer);
    $("duration").textContent = durationText(state.duration);
    $("record-state").textContent = "Your saved idea";
    if (!state.events.length) {
      $("directions").innerHTML = initialDirections;
      $("analysis-summary").innerHTML = initialSummary;
    }
    renderHarmony();
    switchTab(false);
    message("Sketch opened. Keep following the idea.");
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}
async function exportSketch(sketch) {
  const data = { ...sketch, blob: undefined, audio: null };
  if (sketch.blob)
    data.audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(sketch.blob);
    });
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data)], { type: "application/json" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = `${sketch.title.replace(/[^a-z0-9 -]/gi, "").slice(0, 60) || "songcraft-sketch"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importSketch(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    message("Choose a sketch smaller than 20 MB.", true);
    return;
  }
  try {
    const data = JSON.parse(await file.text());
    if (
      data.version !== 1 ||
      typeof data.title !== "string" ||
      data.title.length > 100 ||
      typeof data.notes !== "string" ||
      data.notes.length > 10000 ||
      !Array.isArray(data.events) ||
      data.events.length > 120 ||
      !Array.isArray(data.favorites) ||
      data.favorites.some((x) => ![0, 1, 2].includes(x)) ||
      !Number.isFinite(data.duration) ||
      data.duration < 0 ||
      data.duration > 30.1 ||
      data.events.some(
        (e) =>
          !Number.isInteger(e.midi) ||
          e.midi < 36 ||
          e.midi > 96 ||
          !Number.isFinite(e.start) ||
          e.start < 0 ||
          e.start > 30 ||
          !Number.isFinite(e.duration) ||
          e.duration <= 0 ||
          e.duration > 30,
      )
    )
      throw new Error("This is not a supported Songcraft sketch.");
    let blob = null;
    if (data.audio) {
      if (
        typeof data.audio !== "string" ||
        !/^data:audio\/[\w.+-]+;base64,/.test(data.audio)
      )
        throw new Error("Invalid audio attachment.");
      blob = await (await fetch(data.audio)).blob();
    }
    const sketch = {
      version: 1,
      id: crypto.randomUUID(),
      title: data.title,
      notes: data.notes,
      events: data.events,
      favorites: data.favorites,
      duration: data.duration,
      updated: Date.now(),
      blob,
    };
    await writeSketch(sketch);
    await updateCount();
    await openSketch(sketch);
  } catch (error) {
    message(`Couldn’t import sketch. ${error.message}`, true);
  }
}

const initialDirections = $("directions").innerHTML,
  initialSummary = $("analysis-summary").innerHTML;
$("record").onclick = toggleRecord;
$("mic-check").onclick = async () => {
  if (busy || recording) return;
  if (micChecking) {
    stopMicInput();
    return;
  }
  setBusy(true);
  try {
    await startMicInput();
    setBusy(false);
    message(
      "Mic check is live. Adjust gain, then start recording when you’re ready.",
    );
  } catch (error) {
    stopMicInput();
    setBusy(false);
    message(
      error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow mic access for this site in your browser settings."
        : error.message,
      true,
    );
  }
};
$("input-gain").oninput = () => {
  const decibels = +$("input-gain").value;
  $("gain-value").textContent = `+${decibels} dB`;
  if (inputGain)
    inputGain.gain.setTargetAtTime(
      10 ** (decibels / 20),
      context.currentTime,
      0.025,
    );
};
$("hear-mic").onchange = () => {
  if (monitorGain)
    monitorGain.gain.setTargetAtTime(
      $("hear-mic").checked ? 0.18 : 0,
      context.currentTime,
      0.035,
    );
};
$("demo").onclick = loadDemo;
$("play-riff").onclick = playRiff;
$("audio-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) {
    message("Please choose an audio clip smaller than 30 MB.", true);
    return;
  }
  await acceptAudio(file);
};
$("save").onclick = saveSketch;
$("title").oninput = scheduleSave;
$("notes").oninput = scheduleSave;
$("library-tab").onclick = async () => {
  if (saveTimer) await saveSketch();
  switchTab(true);
  await renderLibrary();
};
$("workbench-tab").onclick = () => switchTab(false);
$("tuner-tab").onclick = () => switchTab("tuner");
function drawTuner() {
  if (!tunerAnalyser) return;
  const spectrum = new Float32Array(tunerAnalyser.frequencyBinCount);
  tunerAnalyser.getFloatFrequencyData(spectrum);
  const readings = estimateStrings(
    spectrum,
    tunerContext.sampleRate,
    tunerAnalyser.fftSize,
  );
  let detected = 0;
  const now = performance.now();
  STRINGS.forEach((string, i) => {
    const row = $("tuner-strings").querySelector(
      `[data-string="${string.name}"]`,
    );
    const note = row.querySelector(".string-note");
    const reading = row.querySelector(".string-reading");
    const value = readings[i];
    row.classList.remove("flat", "sharp", "in-tune");
    if (value) {
      tunerSamples[i].push(value.cents);
      if (tunerSamples[i].length > 7) tunerSamples[i].shift();
      const sorted = [...tunerSamples[i]].sort((a, b) => a - b);
      const cents = sorted[Math.floor(sorted.length / 2)];
      if (tunerSamples[i].length < 5 && !tunerHeld[i]) return;
      if (!tunerHeld[i]) {
        tunerHeld[i] = { ...value, cents, seenAt: now };
      } else {
        tunerHeld[i].cents = tunerHeld[i].cents * 0.72 + cents * 0.28;
        tunerHeld[i].frequency =
          440 * 2 ** ((string.midi - 69 + tunerHeld[i].cents / 100) / 12);
        tunerHeld[i].note = value.note;
        tunerHeld[i].seenAt = now;
      }
    }
    const held = tunerHeld[i];
    if (!held) {
      tunerHeld[i] = null;
      tunerSamples[i] = [];
      note.textContent = string.name;
      reading.textContent = "Not detected yet";
      return;
    }
    detected++;
    const offset = Math.round(held.cents);
    const fading = now - held.seenAt > 650;
    note.textContent = held.note;
    if (Math.abs(offset) <= 5) {
      row.classList.add("in-tune");
      reading.textContent = `In tune${fading ? " · held" : ""} · ${held.frequency.toFixed(1)} Hz`;
    } else if (offset < 0) {
      row.classList.add("flat");
      reading.textContent = `${Math.abs(offset)} cents flat${fading ? " · held" : ""} · tune up`;
    } else {
      row.classList.add("sharp");
      reading.textContent = `${offset} cents sharp${fading ? " · held" : ""} · tune down`;
    }
  });
  $("tuner-status").textContent = detected
    ? `${detected} of 6 strings captured · strum again to update`
    : "Listening · strum all six open strings";
  tunerFrame = requestAnimationFrame(drawTuner);
}
function stopTuner() {
  cancelAnimationFrame(tunerFrame);
  tunerStream?.getTracks().forEach((track) => track.stop());
  tunerStream = null;
  tunerAnalyser = null;
  $("tuner-start").textContent = "Start listening";
  $("tuner-status").textContent = tunerHeld.some(Boolean)
    ? "Stopped · last readings kept on screen"
    : "Ready when you are";
}
$("tuner-start").onclick = async () => {
  if (tunerStream) {
    stopTuner();
    return;
  }
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Microphone access isn’t available in this browser.");
    stopMicInput();
    tunerContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (tunerContext.state !== "running") await tunerContext.resume();
    tunerStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    tunerAnalyser = tunerContext.createAnalyser();
    tunerAnalyser.fftSize = 8192;
    tunerAnalyser.smoothingTimeConstant = 0.35;
    tunerContext.createMediaStreamSource(tunerStream).connect(tunerAnalyser);
    tunerHeld = STRINGS.map(() => null);
    tunerSamples = STRINGS.map(() => []);
    $("tuner-start").textContent = "Stop listening";
    $("tuner-status").textContent = "Listening · strum all six open strings";
    drawTuner();
  } catch (error) {
    stopTuner();
    $("tuner-status").textContent =
      error.name === "NotAllowedError"
        ? "Allow microphone access for this site, then try again."
        : error.message;
  }
};
$("new-sketch").onclick = async () => {
  if (saveTimer) await saveSketch();
  stopPlayback();
  Object.assign(state, {
    id: crypto.randomUUID(),
    events: [],
    blob: null,
    buffer: null,
    favorites: [],
    duration: 0,
    harmony: null,
  });
  $("title").value = "";
  $("notes").value = "";
  $("directions").innerHTML = initialDirections;
  $("analysis-summary").innerHTML = initialSummary;
  $("pitch-editor").hidden = true;
  $("next-step").hidden = true;
  $("record-state").textContent = "Your next song starts here";
  $("duration").textContent = "00:00";
  $("save-state").textContent = "Saved on this device";
  drawWave();
  setBusy(false);
  switchTab(false);
  message("A fresh page. Play something and see where it goes.");
};
$("project-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  await importSketch(file);
};
$("rethink").onclick = () => {
  try {
    const notes = parseMelody($("melody").value),
      sameLength = notes.length === state.events.length;
    state.events = notes.map((midi, i) => ({
      midi,
      start: sameLength
        ? state.events[i].start
        : (i * Math.max(2, state.duration)) / notes.length,
      duration: sameLength
        ? state.events[i].duration
        : (Math.max(2, state.duration) / notes.length) * 0.8,
    }));
    state.favorites = [];
    stopPlayback();
    renderHarmony();
    scheduleSave();
    message("Harmony updated. The original recording is unchanged.");
  } catch (error) {
    message(error.message, true);
  }
};
$("variation").onclick = async () => {
  try {
    stopPlayback();
    const ctx = await audio(),
      events = state.events,
      key = state.harmony.key,
      start = ctx.currentTime + 0.08;
    events.forEach((event, i) => {
      let midi = event.midi;
      if (i === events.length - 1) {
        midi = endingNote(events, key);
      }
      tone(ctx, midi, start + event.start, event.duration, 0.16);
    });
    playTimer = setTimeout(
      stopPlayback,
      (Math.max(state.duration, ...events.map((e) => e.start + e.duration)) +
        0.2) *
        1000,
    );
  } catch (error) {
    message(error.message, true);
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (saveTimer) saveSketch();
    if (recording && recorder.state === "recording") recorder.stop();
    if (tunerStream) stopTuner();
  }
});
window.addEventListener("pagehide", () => {
  stream?.getTracks().forEach((t) => t.stop());
});
async function setupOffline() {
  if (!("serviceWorker" in navigator)) {
    $("offline-status").textContent = "Online session";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    $("offline-status").textContent = navigator.onLine
      ? "Ready offline"
      : "Offline · ready to play";
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        )
          $("offline-status").textContent =
            "Update ready · reopen after your session";
      });
    });
  } catch {
    $("offline-status").textContent = "Offline setup unavailable";
  }
}
window.addEventListener("online", () => {
  $("offline-status").textContent = "Ready offline";
});
window.addEventListener("offline", () => {
  $("offline-status").textContent = "Offline · ready to play";
});
drawWave();
updateCount();
setupOffline();
