import {Meteor} from 'meteor/meteor';

// Recovery for an installation whose only Account admin lost their authenticator:
// start once with TS_RESET_2FA=<login e-mail>, sign in with the password, then
// remove the variable. Every other user is reset by an Account admin in User
// management.
export async function reset2faForEmail(email) {
  if (typeof email !== 'string' || !email.trim()) {
    return null;
  }
  const address = email.trim();
  const user = await Meteor.users.findOneAsync({'emails.address': address}, {fields: {_id: 1}});
  if (!user) {
    console.warn(`=> TS_RESET_2FA: no user with the login ${address}`);
    return 0;
  }
  const updated = await Meteor.users.updateAsync(
    {_id: user._id, 'services.twoFactorAuthentication': {$exists: true}},
    {$unset: {'services.twoFactorAuthentication': 1}});
  console.log(updated
    ? `=> TS_RESET_2FA: two-factor authentication of ${address} was turned off. Remove TS_RESET_2FA now.`
    : `=> TS_RESET_2FA: ${address} has no two-factor authentication set up. Remove TS_RESET_2FA.`);
  return updated;
}

Meteor.startup(async function () {
  await reset2faForEmail(process.env.TS_RESET_2FA);
});
