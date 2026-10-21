import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';

// The integration action anchors (Copy details, Create issue, the remove-issue
// crosses) deliberately carry no href: a bare `href` in Blaze emits href="",
// which the browser resolves to the current URL, so clicking one reloaded the
// whole SPA instead of running its handler.
//
// An <a> without an href is not a link, though - it is out of the tab order and
// exposes no role, which made those controls mouse-only. They are what they act
// like, so their templates mark them role="button" tabindex="0" and this
// supplies the other half of the button contract: Enter and Space activate them,
// the way a real <button> does.
//
// Registered once at startup, not per template render - a listener created in an
// onCreated is what made the old `new Clipboard('.copy-information')` stack a
// fresh handler on every re-render.
const ACTIVATABLE = 'a[role="button"]:not([href])';

const SPACE_KEYS = [' ', 'Spacebar'];

// contenteditable="false" is not an editing host, so an anchor that carries it
// must stay activatable.
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isSpace(event) {
  return SPACE_KEYS.indexOf(event.key) !== -1;
}

function ignore(event) {
  // Holding a key repeats keydown at the OS auto-repeat rate. This selector
  // matches .remove-jira / .remove-tfs / .remove-github, whose handlers call a
  // server method that DELETES the linked remote issue, so without this guard a
  // held key issues one such call per tick. A native button does not repeat.
  //
  // Off the NATIVE event: jQuery only mirrors the properties listed for
  // jQuery.event.addProp, and `repeat` is not one of them (`key` and `code` are),
  // so `event.repeat` on the jQuery event is undefined no matter how long the key
  // is held - the guard would read as dead code that always passes.
  const native = event.originalEvent || event;
  if (native.repeat) {
    return true;
  }
  // The handler is delegated from the document, so it has to stay out of the way
  // of anything nested inside one of these anchors that consumes Enter or Space
  // itself - a search field, a select - as more templates opt in.
  return $(event.target).closest(TEXT_ENTRY).length > 0;
}

// The anchor a Space keydown started on. A native button activates on keyup only
// when the press began on it; here the two halves would otherwise be unrelated,
// so releasing a key held since before the focus moved would activate whatever it
// lands on - and one of the things it can land on deletes a remote issue.
let spacePressedOn = null;

Meteor.startup(function () {
  $(document)
    .on('keydown', ACTIVATABLE, function (event) {
      if (ignore(event)) {
        return;
      }
      if (isSpace(event)) {
        spacePressedOn = event.currentTarget;
        // Space would scroll the page; the activation itself waits for keyup,
        // which is where a native button fires it.
        event.preventDefault();
        return;
      }
      if (event.key !== 'Enter') {
        return;
      }
      // Enter submits an enclosing form otherwise.
      event.preventDefault();
      // The native click(), not jQuery's .trigger(): it dispatches one real event
      // that reaches both Blaze's jQuery-delegated handlers and clipboard.js's own
      // native listener. There is no href, so it cannot navigate.
      event.currentTarget.click();
    })
    .on('keyup', ACTIVATABLE, function (event) {
      if (!isSpace(event)) {
        return;
      }
      const pressedOn = spacePressedOn;
      spacePressedOn = null;
      if (pressedOn !== event.currentTarget || ignore(event)) {
        return;
      }
      event.preventDefault();
      event.currentTarget.click();
    });
});
