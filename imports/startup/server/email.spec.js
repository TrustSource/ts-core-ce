
import sendEmail from './email';

import {expect} from 'chai';
import sinon from 'sinon';
import {Email} from 'meteor/email';
import {Config} from '/imports/server/config';

describe('EmailSenderService', function () {

  // The sender reads Config.MAIL_SENDER for the `from` field and validates every
  // argument as a non-empty string. Pin MAIL_SENDER to a known value so the test
  // is deterministic regardless of the environment (MAIL_URL/MAIL_SENDER may be
  // unset in CI).
  let originalMailSender;
  let originalSupportEmail;

  beforeEach(function () {
    originalMailSender = Config.MAIL_SENDER;
    originalSupportEmail = Config.TS_SUPPORT_EMAIL;
    Config.MAIL_SENDER = 'sender@example.com';
    Config.TS_SUPPORT_EMAIL = 'support@example.com';
  });

  afterEach(function () {
    Config.MAIL_SENDER = originalMailSender;
    Config.TS_SUPPORT_EMAIL = originalSupportEmail;
  });

  describe('sendMail', function () {

    it('should be able to send email', async function () {
      // Meteor 3: the sender is async and dispatches through Email.sendAsync
      // (Email.send is the removed synchronous API). Mock the async method.
      const emailMock = sinon.mock(Email);

      emailMock.expects('sendAsync').once().withArgs({
        to: 'receiver',
        from: Config.MAIL_SENDER,
        subject: 'subject',
        text: 'body'
      });

      await sendEmail('receiver', 'subject', 'body');

      expect(() => emailMock.verify()).to.not.throw();
      emailMock.restore();
    });

    it('should throw exception if inputs are missing', async function () {
      // sendEmail is async in Meteor 3, so a failed `check()` rejects the
      // returned promise instead of throwing synchronously.
      let err;
      try {
        await sendEmail('to', 'subject');
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.message).to.equal('Match error: Match error: Expected string, got undefined');
    });

    // Optional replyTo (AC10): passed through when provided, and
    // ABSENT from the options when not - existing callers stay byte-identical.
    it('passes replyTo through to Email.sendAsync when provided', async function () {
      const sendStub = sinon.stub(Email, 'sendAsync').resolves();
      try {
        await sendEmail('receiver', 'subject', '<p>body</p>', true, 'support@example.com');
        expect(sendStub.calledOnce).to.be.true;
        expect(sendStub.firstCall.args[0]).to.deep.equal({
          to: 'receiver',
          from: Config.MAIL_SENDER,
          subject: 'subject',
          html: '<p>body</p>',
          replyTo: 'support@example.com'
        });
      } finally {
        sendStub.restore();
      }
    });

    it('rejects a replyTo other than the support address and sends nothing', async function () {
      // _sendEmail is an auth-gated DDP method: an arbitrary caller-controlled
      // Reply-To would widen a phishing primitive, so replyTo is pinned to the
      // configured support address (TS_SUPPORT_EMAIL).
      const sendStub = sinon.stub(Email, 'sendAsync').resolves();
      try {
        let err;
        try {
          await sendEmail('receiver', 'subject', '<p>body</p>', true, 'attacker@evil.example');
        } catch (e) {
          err = e;
        }
        expect(err).to.exist;
        expect(err.error).to.equal(400);
        expect(sendStub.called).to.be.false;
      } finally {
        sendStub.restore();
      }
    });

    it('rejects every replyTo when no support address is configured', async function () {
      Config.TS_SUPPORT_EMAIL = undefined;
      const sendStub = sinon.stub(Email, 'sendAsync').resolves();
      try {
        let err;
        try {
          await sendEmail('receiver', 'subject', '<p>body</p>', true, 'support@example.com');
        } catch (e) {
          err = e;
        }
        expect(err).to.exist;
        expect(err.error).to.equal(400);
        expect(sendStub.called).to.be.false;
      } finally {
        sendStub.restore();
      }
    });

    it('omits replyTo from the Email.sendAsync options when not provided', async function () {
      const sendStub = sinon.stub(Email, 'sendAsync').resolves();
      try {
        await sendEmail('receiver', 'subject', '<p>body</p>', true);
        expect(sendStub.calledOnce).to.be.true;
        expect(sendStub.firstCall.args[0]).to.deep.equal({
          to: 'receiver',
          from: Config.MAIL_SENDER,
          subject: 'subject',
          html: '<p>body</p>'
        });
        expect(sendStub.firstCall.args[0]).to.not.have.property('replyTo');
      } finally {
        sendStub.restore();
      }
    });
  });
});
