/* global process:false */

import {Meteor} from 'meteor/meteor';
import {Email} from 'meteor/email';
import {Match, check} from 'meteor/check';
import {Config} from '/imports/server/config';

// the MAIL_URL environment variable should be of the form
// smtp://USERNAME:PASSWORD@HOST:PORT/

// `replyTo` is optional: when set it must be the installation's support address
// (TS_SUPPORT_EMAIL) and is added to the mail options; when absent the options
// stay byte-identical to the previous shape - existing callers are unaffected.
// _sendEmail is an auth-gated DDP method, so an arbitrary caller-controlled
// Reply-To would widen a phishing primitive; without a support address set, no
// Reply-To is accepted at all.
const sendEmail = async function (to, subject, body, isHtml, replyTo) {
  const from = Config.MAIL_SENDER;
  console.log('sending email from: ', from, ' to ', to, ' isHtml ', isHtml);

  const NonEmptyString = Match.Where(function (x) {
    check(x, String);
    return x.length > 0;
  });

  check(to, NonEmptyString);
  check(from, NonEmptyString);
  check(subject, NonEmptyString);
  check(body, NonEmptyString);
  check(replyTo, Match.Optional(NonEmptyString));
  if (replyTo && replyTo !== Config.TS_SUPPORT_EMAIL) {
    throw new Meteor.Error(400, 'Invalid replyTo');
  }

  if (Meteor.isServer && process) {
    const url = process.env.MAIL_URL;
    if(!url){
      console.log('=> MAIL_URL variable is missing');
    }
  }
  const mailOptions = {
    to: to,
    from: from,
    subject: subject
  };
  if (replyTo) {
    mailOptions.replyTo = replyTo;
  }
  if (isHtml) {
    mailOptions.html = body;
  } else {
    mailOptions.text = body;
  }
  await Email.sendAsync(mailOptions);
};
export default sendEmail;

Meteor.methods({
  _sendEmail: sendEmail
});
