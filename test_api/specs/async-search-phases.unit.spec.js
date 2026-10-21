// The components lake escalates its loading message as a request
// gets slower, and gives up at a hard timeout so a hung request cannot spin
// forever (the current page's failure mode - component-list.js:30 has no .catch,
// so a rejected indexer call leaves the spinner running until navigation).
//
// The thresholds are the behaviour worth pinning, so they live in a meteor-free
// CommonJS module Jest can require directly. The ReactiveVar wiring on top is
// verified manually in the browser.
const {
  PHASE_THRESHOLDS_MS,
  SEARCH_TIMEOUT_MS,
  phaseForElapsed
} = require('../../imports/client/ui/common/async-search/searchPhases');

describe('#115 search phase thresholds', () => {
  it('escalates at 1s, 5s and 15s', () => {
    expect(PHASE_THRESHOLDS_MS).toEqual([1000, 5000, 15000]);
  });

  it('gives up at 30s', () => {
    expect(SEARCH_TIMEOUT_MS).toBe(30000);
  });

  it('times out strictly after the last escalation', () => {
    expect(SEARCH_TIMEOUT_MS).toBeGreaterThan(
      PHASE_THRESHOLDS_MS[PHASE_THRESHOLDS_MS.length - 1]
    );
  });
});

describe('#115 phaseForElapsed', () => {
  it('shows a bare spinner for the first second', () => {
    expect(phaseForElapsed(0)).toBe(0);
    expect(phaseForElapsed(999)).toBe(0);
  });

  it('escalates on each threshold boundary inclusively', () => {
    expect(phaseForElapsed(1000)).toBe(1);
    expect(phaseForElapsed(4999)).toBe(1);
    expect(phaseForElapsed(5000)).toBe(2);
    expect(phaseForElapsed(14999)).toBe(2);
    expect(phaseForElapsed(15000)).toBe(3);
    expect(phaseForElapsed(60000)).toBe(3);
  });

  it('never exceeds the number of thresholds', () => {
    expect(phaseForElapsed(Number.MAX_SAFE_INTEGER)).toBe(PHASE_THRESHOLDS_MS.length);
  });

  it('treats nonsense input as phase 0 rather than throwing', () => {
    expect(phaseForElapsed(-1)).toBe(0);
    expect(phaseForElapsed(NaN)).toBe(0);
    expect(phaseForElapsed(Infinity)).toBe(0);
    expect(phaseForElapsed(undefined)).toBe(0);
    expect(phaseForElapsed('abc')).toBe(0);
  });
});
