// Where the guided tour puts its tooltip next to the highlighted element.
//
// Meteor-free CommonJS so Jest can require it directly
// (test_api/specs/tour-placement.unit.spec.js). The DOM half lives in
// imports/client/ui/common/guide/tour.js.

// Space between the highlighted element and the tooltip.
const GAP = 16;
// Closest the tooltip may come to the viewport edge.
const MARGIN = 8;

const OPPOSITE = {top: 'bottom', bottom: 'top', left: 'right', right: 'left'};
const OTHER_AXIS = {top: ['right', 'left'], bottom: ['right', 'left'], left: ['bottom', 'top'], right: ['bottom', 'top']};

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function centered(tooltip, viewport) {
  return {
    top: Math.round((viewport.height - tooltip.height) / 2),
    left: Math.round((viewport.width - tooltip.width) / 2),
    side: 'center'
  };
}

// Whether the tooltip fits on `side` of the target without leaving the viewport.
function fits(side, target, tooltip, viewport) {
  switch (side) {
  case 'right': return target.left + target.width + GAP + tooltip.width <= viewport.width - MARGIN;
  case 'left': return target.left - GAP - tooltip.width >= MARGIN;
  case 'bottom': return target.top + target.height + GAP + tooltip.height <= viewport.height - MARGIN;
  case 'top': return target.top - GAP - tooltip.height >= MARGIN;
  default: return false;
  }
}

/**
 * Position for a tooltip of size `tooltip` ({width, height}) next to `target`
 * (a DOMRect-like {top, left, width, height}, viewport coordinates) inside
 * `viewport` ({width, height}).
 *
 * `position` is the preferred side (top/right/bottom/left, default bottom). When
 * it does not fit, the opposite side is tried, then the two sides of the other
 * axis; when nothing fits - or there is no target - the tooltip is centred.
 * Along the side it is aligned to the target's top or left edge and then kept
 * MARGIN inside the viewport.
 */
function placeTooltip(target, tooltip, viewport, position) {
  if (!target) {
    return centered(tooltip, viewport);
  }
  const preferred = OPPOSITE[position] ? position : 'bottom';
  const order = [preferred, OPPOSITE[preferred]].concat(OTHER_AXIS[preferred]);
  const side = order.find((candidate) => fits(candidate, target, tooltip, viewport));
  if (!side) {
    return centered(tooltip, viewport);
  }
  const maxTop = viewport.height - MARGIN - tooltip.height;
  const maxLeft = viewport.width - MARGIN - tooltip.width;
  let top;
  let left;
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? target.left + target.width + GAP : target.left - GAP - tooltip.width;
    top = clamp(target.top, MARGIN, maxTop);
  } else {
    top = side === 'bottom' ? target.top + target.height + GAP : target.top - GAP - tooltip.height;
    left = clamp(target.left, MARGIN, maxLeft);
  }
  return {top: Math.round(top), left: Math.round(left), side};
}

module.exports = {placeTooltip, GAP, MARGIN};
