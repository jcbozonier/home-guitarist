# Songcraft

A small, offline-capable musical workshop. Record a single-note guitar riff, audition three supporting chord progressions, and keep recordings and observations in a sketchbook.

Live app: https://jcbozonier.github.io/home-guitarist/

## Verified in the first release

Six automated tests cover guitar pitches with harmonics, silence, note/rest timing, melody parsing, harmonic alternatives, and changed endings. Browser checks cover demo and imported-audio analysis, accompaniment controls, notes and favorites, saved sketch reopening, complete JSON export/import, a 390px phone layout, and offline reload with the development server stopped. Physical iPhone/iPad/Android microphone and audio-output behavior remains to be tested.

## Run locally

Serve this directory with `python3 -m http.server 5173` and open `http://localhost:5173`. No package installation or build is required. Microphone access needs HTTPS or localhost. On phones, use the HTTPS deployment rather than a LAN HTTP URL.

Run `npm test` (Node 22+) for the music-analysis tests. Every push to `main` runs tests and deploys the static app to GitHub Pages through `.github/workflows/pages.yml`.

## First version

- Microphone recording and audio import, up to 30 seconds.
- Local YIN pitch detection in a worker, optimized for clean single-note phrases. No network model, LLM, account, or audio uploads.
- Editable melody, candidate tonal centers, three chord progressions, and synthesized accompaniment under the original recording.
- Audible alternate ending, favorite directions, notes, and IndexedDB sketch storage.
- Export/import of complete sketches including audio.
- Service-worker caching for offline reopening and home-screen manifest.

The demo is synthesized locally and uses its known melody; imported and recorded audio goes through actual pitch detection. Harmony uses duration-weighted pitch-class profiles and diatonic templates, not a trained composition model. These are exploratory starting points, not authoritative transcriptions. Chords span four equal portions of the clip; there is no beat tracking yet.

## Limits and next steps

Chords, distorted guitar, and full mixes are not reliably transcribed. Notes need manual correction when the detector misses attacks, merges repeated notes, or mistakes harmonics. Precise fingering, picking technique, automatic tempo estimation, looping/overdubbing, lyric retrieval, and multi-instrument separation are future work. Test microphone recording and latency on target iOS/Android devices before promising hardware support.

Keep the app foregrounded while recording. Switching away stops the recording and attempts to save it. Browser shutdown can interrupt this. Browser storage can be cleared or evicted; export important sketches. Projects remain separate on each device unless you export/import them. Initial installation needs a successful online load; subsequent offline launches work while cached files remain available. Updates activate after the old app tabs close, avoiding mid-session replacement.

## Product direction

Start with **play a riff → hear supporting chords → explore a variation → save a sketch**. Grow into a songcraft workshop: a materials shelf of ideas and study notes, playable guitar arrangements, theory tied to your own music, and simple layered songs. Keep the musical engine useful without an LLM; consider conversational explanations as an optional later layer.
