/* global document:false, window:false */
// Guided tour: dims the page, cuts a spotlight around one element at a time and
// explains it in a tooltip with Cancel / Back / Next. Replaces intro.js.
//
// The spotlight is a transparent box with an enormous box-shadow drawn above
// everything else, so the highlighted element shows through the hole whatever
// its own stacking context is - intro.js had to lift the element above its
// overlay, which needed the z-index overrides for the fixed header and sidebars.
//
// Steps come from imports/lib/tour/guides.js. Text is set with textContent,
// never parsed as HTML.
import {placeTooltip} from '/imports/lib/tour/placement';

const SPOTLIGHT_PADDING = 6;
const HIGHLIGHT_CLASS = 'ts-guide-highlight';
const HIGHLIGHT_MS = 2000;

// Narrower than this on screen counts as hidden: on a phone the sidebar is
// slid off canvas and only a sliver of it would be lit.
const MIN_VISIBLE_WIDTH = 24;

let active = null;

// Rendered and not pushed off screen sideways. Below the fold is fine - the tour
// scrolls there.
function isVisible(element) {
  if (!element || element.getClientRects().length === 0) return false;
  const rect = element.getBoundingClientRect();
  return Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0) >= MIN_VISIBLE_WIDTH;
}

function findElement(selector) {
  if (!selector) return null;
  const element = document.querySelector(selector);
  return isVisible(element) ? element : null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className, label) {
  const node = el('button', 'btn btn-sm ' + className, label);
  node.type = 'button';
  return node;
}

// The part of the element's box that is inside the viewport, padded.
function visibleRect(element) {
  const rect = element.getBoundingClientRect();
  const top = Math.max(rect.top - SPOTLIGHT_PADDING, 0);
  const left = Math.max(rect.left - SPOTLIGHT_PADDING, 0);
  const bottom = Math.min(rect.bottom + SPOTLIGHT_PADDING, window.innerHeight);
  const right = Math.min(rect.right + SPOTLIGHT_PADDING, window.innerWidth);
  if (bottom <= top || right <= left) return null;
  return {top, left, width: right - left, height: bottom - top};
}

function buildDom() {
  const root = el('div', 'ts-tour');
  const blocker = el('div', 'ts-tour-blocker');
  const spotlight = el('div', 'ts-tour-spotlight');
  const tooltip = el('div', 'ts-tour-tooltip');
  tooltip.setAttribute('role', 'dialog');
  tooltip.setAttribute('aria-modal', 'true');
  tooltip.setAttribute('aria-labelledby', 'ts-tour-title');
  tooltip.setAttribute('aria-describedby', 'ts-tour-text');

  const header = el('div', 'ts-tour-header');
  const number = el('span', 'ts-tour-number');
  const title = el('h4', 'ts-tour-title');
  title.id = 'ts-tour-title';
  header.append(number, title);

  const text = el('p', 'ts-tour-text');
  text.id = 'ts-tour-text';
  const bullets = el('div', 'ts-tour-bullets');

  const footer = el('div', 'ts-tour-footer');
  const cancel = button('ts-tour-cancel', 'Cancel');
  const back = button('ts-tour-back', 'Back');
  const next = button('btn-primary ts-tour-next', 'Next');
  footer.append(cancel, el('span', 'ts-tour-spacer'), back, next);

  tooltip.append(header, text, bullets, footer);
  root.append(blocker, spotlight, tooltip);
  return {root, spotlight, tooltip, number, title, text, bullets, cancel, back, next};
}

function position(tour) {
  const step = tour.steps[tour.index];
  const element = findElement(step.selector);
  const rect = element ? visibleRect(element) : null;
  const {spotlight, tooltip} = tour.dom;
  if (rect) {
    spotlight.style.display = '';
    spotlight.style.top = rect.top + 'px';
    spotlight.style.left = rect.left + 'px';
    spotlight.style.width = rect.width + 'px';
    spotlight.style.height = rect.height + 'px';
  } else {
    spotlight.style.display = 'none';
  }
  tour.dom.root.classList.toggle('ts-tour-no-target', !rect);
  const placed = placeTooltip(rect, {width: tooltip.offsetWidth, height: tooltip.offsetHeight},
    {width: window.innerWidth, height: window.innerHeight}, step.position);
  tooltip.style.top = placed.top + 'px';
  tooltip.style.left = placed.left + 'px';
  tooltip.setAttribute('data-side', placed.side);
}

function show(tour, index) {
  tour.index = index;
  const step = tour.steps[index];
  const last = index === tour.steps.length - 1;
  const {dom} = tour;
  dom.number.textContent = String(index + 1);
  dom.title.textContent = step.title || '';
  dom.title.style.display = step.title ? '' : 'none';
  dom.text.textContent = step.text;
  dom.back.disabled = index === 0;
  dom.next.textContent = last ? 'Done' : 'Next';
  Array.from(dom.bullets.children).forEach((bullet, i) => {
    bullet.classList.toggle('active', i === index);
    bullet.setAttribute('aria-current', i === index ? 'step' : 'false');
  });
  const element = findElement(step.selector);
  if (element) {
    element.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }
  position(tour);
  dom.next.focus();
}

function onKeydown(event) {
  const tour = active;
  if (!tour) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    endTour();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    go(tour, 1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    go(tour, -1);
  } else if (event.key === 'Tab') {
    // Keep focus inside the tooltip while the page behind it is blocked.
    const focusable = Array.from(tour.dom.tooltip.querySelectorAll('button:not([disabled])'));
    const first = focusable[0];
    const lastButton = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && current === first) {
      event.preventDefault();
      lastButton.focus();
    } else if ((!event.shiftKey && current === lastButton) || !tour.dom.tooltip.contains(current)) {
      event.preventDefault();
      first.focus();
    }
  }
}

function onViewportChange() {
  const tour = active;
  if (!tour || tour.frame) return;
  tour.frame = window.requestAnimationFrame(function () {
    tour.frame = null;
    if (active === tour) position(tour);
  });
}

function go(tour, delta) {
  const index = tour.index + delta;
  if (index < 0) return;
  if (index >= tour.steps.length) {
    endTour(true);
    return;
  }
  show(tour, index);
}

/**
 * Ends the running tour, if any. `completed` tells onExit whether the last step
 * was reached with Done rather than cancelled.
 */
export function endTour(completed) {
  const tour = active;
  if (!tour) return;
  active = null;
  document.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
  document.removeEventListener('transitionend', onViewportChange, true);
  if (tour.frame) window.cancelAnimationFrame(tour.frame);
  tour.dom.root.remove();
  document.body.classList.remove('ts-tour-open');
  if (tour.returnFocus && document.contains(tour.returnFocus)) {
    tour.returnFocus.focus();
  }
  if (tour.onExit) tour.onExit({completed: !!completed});
}

/**
 * Starts a tour over `steps` ({selector?, title?, text, position?}). Steps whose
 * element is not on the page (or not visible) are left out; a step without a
 * selector is shown centred. `intro`, when given, is shown first as a centred
 * step. Returns false when there is nothing to show.
 */
export function startTour(steps, {intro, onExit} = {}) {
  endTour();
  const visible = (steps || []).filter((step) => !step.selector || findElement(step.selector));
  if (intro) visible.unshift({text: intro});
  if (!visible.length) return false;

  const dom = buildDom();
  visible.forEach((step, i) => {
    const bullet = el('button', 'ts-tour-bullet');
    bullet.type = 'button';
    bullet.setAttribute('aria-label', 'Step ' + (i + 1) + (step.title ? ': ' + step.title : ''));
    dom.bullets.append(bullet);
  });

  const tour = {steps: visible, index: 0, dom, onExit, returnFocus: document.activeElement, frame: null,
    path: window.location.pathname};
  active = tour;

  dom.cancel.addEventListener('click', function () { endTour(); });
  dom.back.addEventListener('click', function () { go(tour, -1); });
  dom.next.addEventListener('click', function () { go(tour, 1); });
  dom.bullets.addEventListener('click', function (event) {
    const index = Array.prototype.indexOf.call(dom.bullets.children, event.target);
    if (index >= 0) show(tour, index);
  });
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
  // Layout that animates into place (a panel sliding, a sidebar collapsing) moves
  // the highlighted element without a resize or scroll.
  document.addEventListener('transitionend', onViewportChange, true);

  document.body.classList.add('ts-tour-open');
  document.body.append(dom.root);
  show(tour, 0);
  return true;
}

/**
 * Ends the running tour when the page it started on is no longer shown. The
 * query string is ignored: the module page moves its own `?analysis=` while
 * staying the same screen.
 */
export function endTourIfMovedAway() {
  if (active && active.path !== window.location.pathname) {
    endTour();
  }
}

export function isTourActive() {
  return !!active;
}

/**
 * Scrolls one element into view and outlines it briefly - what the guide panel
 * does when a step is clicked. Returns false when the element is not on the page.
 */
export function highlightElement(selector) {
  const element = findElement(selector);
  if (!element) return false;
  element.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
  // Removed and re-added a frame later so the animation restarts when the same
  // step is clicked twice.
  element.classList.remove(HIGHLIGHT_CLASS);
  window.requestAnimationFrame(function () {
    element.classList.add(HIGHLIGHT_CLASS);
  });
  window.clearTimeout(element.tsGuideHighlightTimer);
  element.tsGuideHighlightTimer = window.setTimeout(function () {
    element.classList.remove(HIGHLIGHT_CLASS);
  }, HIGHLIGHT_MS);
  return true;
}

export {findElement as findGuideElement};
