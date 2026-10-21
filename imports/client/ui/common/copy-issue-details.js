import {Template} from 'meteor/templating';
import Clipboard from 'clipboard';
import Notify from '/imports/api/notify';

const COPIED = 'Information was successfully copied';
// Active voice, naming what failed: the convention every other failure toast in
// the product follows ("Could not remove Jira issue" in this very panel,
// "Could not copy to clipboard" on the profile page).
const NOT_COPIED = 'Could not copy the issue details to the clipboard';

// clipboard.js reports nothing about the outcome: its static copy() hands back
// the text it selected and throws away the boolean document.execCommand('copy')
// returns (see `command()` in dist/clipboard.js, which even swallows the throw
// as `false`). Calling it and announcing success therefore asserts something we
// never observed - the same defect the API key copy button was fixed for, where
// a failed reveal still produced a "successfully copied" toast. So gate on
// navigator.clipboard's promise, exactly as
// imports/client/ui/settings/api/company-api-keys.js does.
function copyIssueText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      Notify.success(COPIED);
    }).catch(function (error) {
      // The rejection is a browser DOMException - "Document is not focused.",
      // "Write permission denied." - which names no subject, so showing it as
      // the whole toast never told the user WHAT had failed. Nothing here is a
      // server round-trip whose own reason would be worth surfacing (unlike the
      // API key copy, which reports the reveal's reason), so the message stays
      // ours and the exception goes where it can be diagnosed.
      console.error(error);
      Notify.danger(NOT_COPIED);
    });
    return;
  }
  // navigator.clipboard is absent outside a secure context - a self-hosted
  // instance served over plain HTTP. Fall back to clipboard.js (which builds the
  // off-screen element and selects it for us) but take the outcome from the
  // `copy` event: document.execCommand('copy') fires it only when it is actually
  // allowed to run, so it is the success signal clipboard.js discards. Both the
  // call and the event are synchronous, so the listener cannot outlive them.
  //
  // The STATIC copy(), never `new Clipboard(selector)`: that constructor
  // registers a delegated listener on document.body which the integration
  // templates never destroyed, so every re-render stacked another handler on the
  // same links.
  let copied = false;
  const onCopy = function () {
    copied = true;
  };
  document.addEventListener('copy', onCopy, true);
  try {
    Clipboard.copy(text);
  } finally {
    document.removeEventListener('copy', onCopy, true);
  }
  if (copied) {
    Notify.success(COPIED);
  } else {
    Notify.danger(NOT_COPIED);
  }
}

// "Copy details" is generic - it only needs the issue description, not an
// integration. It used to be rendered by jiraLink/tfsLink/githubIssuesLink
// themselves, each on its own "is this integration configured" condition, so a
// Tasks panel could show two identical Copy details links or, with everything
// connected, none at all. Render it once per panel instead, on the only
// condition that matters: there is something to copy.
Template.copyIssueDetails.events({
  'click .copy-issue-details': function (event, instance) {
    event.preventDefault();
    const description = instance.data && instance.data.description;
    const text = description && description.text;
    if (!text) return;
    copyIssueText(text);
  }
});
