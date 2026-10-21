/* eslint-disable no-undef */
// The guided tours (dashboard, module page) replaced intro.js with an own
// helper. Its DOM half is checked in the browser; the part that decides WHERE
// the tooltip goes is Meteor-free so it can be tested here.
const {placeTooltip, GAP, MARGIN} = require('../../imports/lib/tour/placement');

const viewport = {width: 1200, height: 800};
const tooltip = {width: 300, height: 150};
const target = {top: 300, left: 400, width: 200, height: 100};

describe('placeTooltip', () => {
  it('centres the tooltip when there is no target', () => {
    expect(placeTooltip(null, tooltip, viewport, 'right')).toEqual({
      top: 325, left: 450, side: 'center'
    });
  });

  it('places right of the target, top-aligned', () => {
    expect(placeTooltip(target, tooltip, viewport, 'right')).toEqual({
      top: 300, left: 600 + GAP, side: 'right'
    });
  });

  it('places left of the target', () => {
    expect(placeTooltip(target, tooltip, viewport, 'left')).toEqual({
      top: 300, left: 400 - GAP - 300, side: 'left'
    });
  });

  it('places below the target, left-aligned', () => {
    expect(placeTooltip(target, tooltip, viewport, 'bottom')).toEqual({
      top: 400 + GAP, left: 400, side: 'bottom'
    });
  });

  it('places above the target', () => {
    expect(placeTooltip(target, tooltip, viewport, 'top')).toEqual({
      top: 300 - GAP - 150, left: 400, side: 'top'
    });
  });

  it('defaults to bottom for an unknown position', () => {
    expect(placeTooltip(target, tooltip, viewport, undefined).side).toBe('bottom');
  });

  it('flips to the opposite side when the preferred one does not fit', () => {
    const nearRightEdge = {top: 300, left: 1000, width: 150, height: 100};
    expect(placeTooltip(nearRightEdge, tooltip, viewport, 'right')).toEqual({
      top: 300, left: 1000 - GAP - 300, side: 'left'
    });
    const nearBottom = {top: 700, left: 400, width: 200, height: 60};
    expect(placeTooltip(nearBottom, tooltip, viewport, 'bottom').side).toBe('top');
  });

  it('tries the other axis when neither side of the preferred one fits', () => {
    // As wide as the viewport: nothing fits left or right, so it goes below.
    const fullWidth = {top: 100, left: 0, width: 1200, height: 60};
    expect(placeTooltip(fullWidth, tooltip, viewport, 'right').side).toBe('bottom');
  });

  it('centres when the tooltip fits on no side', () => {
    const huge = {top: 0, left: 0, width: 1200, height: 800};
    expect(placeTooltip(huge, tooltip, viewport, 'left').side).toBe('center');
  });

  it('keeps the tooltip inside the viewport margin', () => {
    // A tall menu at the left edge: right side fits, but top-aligning to a
    // target that starts above the viewport would push the tooltip off screen.
    const offTop = {top: -200, left: 0, width: 200, height: 900};
    const placed = placeTooltip(offTop, tooltip, viewport, 'right');
    expect(placed.side).toBe('right');
    expect(placed.top).toBe(MARGIN);
    const lowTarget = {top: 750, left: 0, width: 200, height: 40};
    expect(placeTooltip(lowTarget, tooltip, viewport, 'right').top).toBe(800 - MARGIN - 150);
  });
});
