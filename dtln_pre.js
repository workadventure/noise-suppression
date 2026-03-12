Module.noInitialRun = true;

function getRandomValues(abv) {
  let len = abv.length;
  while (len--) {
    abv[len] = Math.random() * Number.MAX_SAFE_INTEGER;
  }
  return abv;
}

// AudioWorklets are pain and horror. Many common facilities aren't implemented
// in them by default. As an example, the crypto and performance APIs are not
// available. These are used by emscripten as the base of some of its POSIX
// emulation layer, and so we have to provide them. It's *very* important that
// the getRandomValues polyfill isn't used anywhere else, because it is using
// Math.random(), and will not produce a secure seed.
let crypto =
  typeof AudioWorkletGlobalScope !== 'undefined'
    ? { getRandomValues }
    : globalThis.crypto;
let performance =
  typeof AudioWorkletGlobalScope !== 'undefined'
    ? { now: () => Date.now() }
    : globalThis.performance;
