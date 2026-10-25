import { transcribe } from "./music.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      events: transcribe(data.samples, data.rate),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
