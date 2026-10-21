// Timing policy for a slow search request.
//
// CommonJS with no meteor/* imports so Jest can require it directly. The
// thresholds live apart from the ReactiveVar machinery in asyncSearchState.js
// precisely so they are testable without a Meteor harness.
//
// Phase 0 is a bare spinner: below a second, text would flash and read as noise.
// Phases 1-3 escalate the wording so a slow request stays honest instead of
// showing one indefinite spinner.

const PHASE_THRESHOLDS_MS = [1000, 5000, 15000];

// Hard ceiling. Past this the request is abandoned and the error state takes
// over, so a hung call cannot spin forever.
const SEARCH_TIMEOUT_MS = 30000;

function phaseForElapsed(elapsedMs) {
  const ms = Number(elapsedMs);
  if (!Number.isFinite(ms) || ms < 0) {
    return 0;
  }
  let phase = 0;
  for (const threshold of PHASE_THRESHOLDS_MS) {
    if (ms >= threshold) {
      phase += 1;
    }
  }
  return phase;
}

module.exports = {PHASE_THRESHOLDS_MS, SEARCH_TIMEOUT_MS, phaseForElapsed};
