// Web Worker: computes first-visit times on an equal-area sky grid so the
// main thread can show "% of sky covered" for any time instantly.
import { computeCoverage } from './coverage.js';

self.onmessage = (e) => {
  const { data, count } = e.data;
  const { times, cumArea } = computeCoverage(data, count);
  self.postMessage({ times, cumArea }, [times.buffer, cumArea.buffer]);
};
