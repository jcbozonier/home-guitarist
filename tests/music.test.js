import { test } from 'node:test';
import assert from 'node:assert/strict';
import {detectPitch, transcribe, frequency, parseMelody, analyzeHarmony, demoEvents, endingNote} from '../music.js';
test('pitch detector recognizes guitar pitches with harmonics',()=>{
  for (const midi of [40,45,52,57,64,69,76]) {
    const hz=frequency(midi), samples=Float32Array.from({length:1024},(_,i)=>.25*Math.sin(2*Math.PI*hz*i/8000)+.08*Math.sin(4*Math.PI*hz*i/8000));
    const result=detectPitch(samples,8000);
    assert.ok(result, `detect ${midi}`); assert.ok(Math.abs(12*Math.log2(result.hz/hz))<.1, `accurate ${midi}`);
  }
});
test('silence produces no invented notes',()=>assert.equal(detectPitch(new Float32Array(1024),8000),null));
test('transcription separates notes and preserves a rest',()=>{
  const samples=new Float32Array(16000);
  for(let i=0;i<6000;i++) samples[i]=.3*Math.sin(2*Math.PI*220*i/8000);
  for(let i=8500;i<15000;i++) samples[i]=.3*Math.sin(2*Math.PI*329.63*i/8000);
  const events=transcribe(samples,8000);
  assert.deepEqual(events.map(x=>x.midi),[57,64]); assert.ok(events[1].start>1);
});
test('editable melody supports sharps and flats and rejects malformed inputs',()=>{
  assert.deepEqual(parseMelody('A3 C#4 Eb4'),[57,61,63]);
  assert.throws(()=>parseMelody('<script>')); assert.throws(()=>parseMelody('')); assert.throws(()=>parseMelody('C0'));
});
test('harmony gives three distinct progressions and valid chord tones',()=>{
  const result=analyzeHarmony(demoEvents);
  assert.equal(result.directions.length,3);
  assert.equal(new Set(result.directions.map(d=>d.chords.map(c=>c.name).join())).size,3);
  for(const d of result.directions) for(const c of d.chords) assert.equal(c.tones.length,3);
  assert.throws(()=>analyzeHarmony([]));
});
test('development changes an ending that already lands on the tonic',()=>{
  assert.equal(endingNote(demoEvents,{root:9,mode:'minor'}),60);
});
