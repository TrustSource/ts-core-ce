/* global navigator:false, Blob:false, ClipboardItem:false */
import {Meteor} from 'meteor/meteor';
import Notify from '/imports/api/notify';

/**
 * Copy a stored key to the clipboard. The page only holds the key's id; `method`
 * (e.g. publicCsafKey.reveal) returns the plaintext after a role check.
 *
 * The clipboard write is started in the click itself, with a promise for the text:
 * awaiting the server first would lose the user activation, and browsers (Safari
 * especially) then refuse the write.
 *
 * @param {String} method the reveal method
 * @param {String} id     the key's id
 */
export function copyRevealedKey(method, id) {
  let reported = false;
  const notifyFailure = function (error) {
    if (!reported) {
      reported = true;
      Notify.danger((error && (error.reason || error.message)) || 'Unable to copy the key');
    }
  };
  const reveal = Meteor.callAsync(method, id).then(function (plainKey) {
    if (typeof plainKey !== 'string' || plainKey.length === 0) {
      throw new Error('The key could not be read - please reload the page and try again');
    }
    return plainKey;
  });
  reveal.catch(notifyFailure);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
    const text = reveal.then((plainKey) => new Blob([plainKey], {type: 'text/plain'}));
    navigator.clipboard.write([new ClipboardItem({'text/plain': text})]).then(function () {
      Notify.success('Information was successfully copied');
    }).catch(notifyFailure);
  } else {
    reveal.then((plainKey) => navigator.clipboard.writeText(plainKey)).then(function () {
      Notify.success('Information was successfully copied');
    }).catch(notifyFailure);
  }
}
