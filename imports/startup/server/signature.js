import {Meteor} from 'meteor/meteor';
import Signature from '/imports/lib/models/signature';
import {denyDDP} from '/imports/server/security/methodGuards';

Meteor.methods({
  // Server-internal only. With keyed HMAC signing, exposing this over DDP would
  // be a signing oracle (any client could mint a valid signature for arbitrary
  // content), so denyDDP rejects any DDP-originated call. Trusted server code
  // (no this.connection) may still invoke it via Meteor.callAsync('Signature.Get').
  'Signature.Get': async function (data) {
    denyDDP(this);
    return Signature.get(data);
  },
  'Signature.Verify': Signature.verify
});
