import {Meteor} from 'meteor/meteor';
import {Accounts} from 'meteor/accounts-base';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {Config} from '/imports/server/config';
import {trustedCompanyAssignment} from '/imports/startup/server/accounts';
import {planInitialAdmin} from '/imports/server/initialAdmin/initialAdminPlan';
import {COMPANY_OWNER_ROLES} from '/imports/server/userRoles';

// Seeds the first admin of a fresh installation from INITIAL_ADMIN_EMAIL /
// INITIAL_ADMIN_PASSWORD (INITIAL_COMPANY_NAME optional), only while the database has
// no users. The user is created with the fixture marker inside the trusted company
// assignment, so onCreateUser attaches it to the company created here and skips the
// sign-up side effects (new company, verification and sales mails); the marker is removed straight after. Any failure is logged and startup
// continues; if the user could not be created, the company inserted for it is
// removed again, so the next start seeds cleanly.
Meteor.startup(async () => {
  let companyId = null;
  let userId = null;
  try {
    const plan = planInitialAdmin({
      userCount: await Meteor.users.find().countAsync(),
      email: Config.INITIAL_ADMIN_EMAIL,
      password: Config.INITIAL_ADMIN_PASSWORD,
      companyName: Config.INITIAL_COMPANY_NAME
    });
    if (!plan.seed) {
      if (plan.reason !== 'users exist') {
        console.log('=> Initial admin not created:', plan.reason);
      }
      return;
    }
    companyId = await Companies.insertAsync({
      created: new Date(),
      name: plan.companyName,
      apiKeys: []
    });
    userId = await trustedCompanyAssignment.withValue(true, () => Accounts.createUserAsync({
      email: plan.email,
      password: Config.INITIAL_ADMIN_PASSWORD,
      profile: {companyId: companyId, email: plan.email, testuser: true}
    }));
    await Meteor.users.updateAsync(userId, {$unset: {'profile.testuser': 1}});
    await Roles.setUserRolesAsync(userId, COMPANY_OWNER_ROLES, {scope: companyId});
    console.log('=> Initial admin created:', plan.email, 'in company', plan.companyName);
  } catch (e) {
    if (companyId && !userId) {
      try {
        await Companies.removeAsync({_id: companyId});
      } catch (removeError) {
        console.error('=> Initial admin company could not be removed:', removeError && removeError.message);
      }
    }
    console.error('=> Initial admin could not be created:', e && e.message);
  }
});
