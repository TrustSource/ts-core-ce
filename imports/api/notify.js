import toastr from 'toastr';
import 'toastr/build/toastr.min.css';

import {Meteor} from 'meteor/meteor';
import Utils from '/imports/lib/utils';

Meteor.startup(function () {
  toastr.options = {
    debug: false,
    newestOnTop: false,
    preventDuplicates: true,
    positionClass: 'toast-top-center',
    toastClass: 'toast animated fadeInDown',
    // toastr 2.1.4 defaults this to FALSE and renders a message with
    // `$messageElement.append(message)`, which PARSES it as HTML. That default
    // never applied here anyway: this assignment REPLACES toastr.options rather
    // than extending it, so the library's own defaults block is dropped and the
    // flag has to be set by hand.
    //
    // Every toast in this product is a potential sink for whatever string its
    // caller was handed - a component name, a project name, an upstream error
    // body - and the app's CSP permits inline event handlers, so a rendered
    // `onerror=` runs. Escaping is therefore the DEFAULT, and markup is an
    // explicit opt-in (see successHtml).
    escapeHtml: true
  };
});

const Notify = {
  success: create.bind(this, 'success', 'fa-check', 1500, false),
  info: create.bind(this, 'info', 'fa-info', 3000, false),
  warn: create.bind(this, 'warning', 'fa-exclamation-triangle', 3000, false),
  danger: create.bind(this, 'error', 'fa-bomb', 3000, false),
  // The opt-ins, for the handful of toasts that carry developer-authored markup.
  // Every one of them is a fixed string; none interpolates anything a user
  // supplied.
  //
  // Separate entry points rather than a flag on the existing ones on purpose: it
  // makes "this toast renders HTML" a deliberate, greppable act, and it means a
  // caller cannot reach the unescaped path by accident.
  //
  // Only these two exist because only these two are needed: five success toasts
  // use `<br>` to separate a confirmation from its NOTE, and one danger toast
  // carries a support link. Anything else stays escaped.
  successHtml: create.bind(this, 'success', 'fa-check', 1500, true),
  dangerHtml: create.bind(this, 'error', 'fa-bomb', 3000, true)
};

function create(type, icon, delay, allowHtml) {
  const args = Array.prototype.slice.call(arguments, 4);
  const message = Utils.format.apply(null, args);
  toastr.options.timeout = delay;
  // Passed per call rather than left to the shared options object, so the
  // opt-in cannot leak into the next toast: `toastr.options` is module-global
  // and mutated above, and a flag set there would stay set.
  toastr[type](message, undefined, {escapeHtml: !allowHtml});
}

export default Notify;
