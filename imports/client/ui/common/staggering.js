import {Template} from 'meteor/templating';

// Fades the children of a {{#staggering}} block in one after another.
// child: class of the children to animate (default: the columns of a .row)
// effect: animate.css effect class (default fadeIn)
// delay: step between children in tenths of a second (default 0.6)
Template.staggering.onRendered(function () {
  const root = this.firstNode;
  if (!root || !root.querySelectorAll) {
    return;
  }
  const effect = root.dataset.effect || 'fadeIn';
  const step = root.dataset.delay ? Number(root.dataset.delay) / 10 : 0.06;
  const selector = root.dataset.child ? '.' + root.dataset.child : '.row > div';

  root.querySelectorAll(selector).forEach(function (el, i) {
    el.classList.add('ts-stagger-item', effect);
    el.style.animationDelay = (Math.round(step * (i + 2) * 10) / 10) + 's';
  });
});
