import {Meteor} from 'meteor/meteor';
import LoginsHistory from '/imports/lib/collections/loginsHistory';
import Utils from '/imports/lib/utils';
import {Config} from '/imports/server/config';

Meteor.methods({
  'LoginsHistory.Create': async function ({type, allowed, methodName, user, error}) {
    // A `resume` is an existing session reconnecting (every page load and every
    // reconnect), not a sign-in: recording it buried the real logins and grew the
    // collection with ordinary browsing.
    if (type === 'resume') {
      return null;
    }
    if(user){
      const companyId = user.profile && user.profile.companyId;
      let doc = {
        created: new Date(),
        companyId: companyId,
        userId: user._id,
        userName: Utils.username(user),
        userEmail: user.profile && user.profile.email,
        type,
        allowed,
        methodName
      };
      return await LoginsHistory.insertAsync(doc)
    }else{
      if (Config.DEBUG_MODE_ENABLED) {
        console.log('Login > ', error.toString())
      }
      let doc = {
        created: new Date(),
        type,
        allowed,
        methodName,
        error: error.toString()
      };
      return await LoginsHistory.insertAsync(doc)
    }
  }
});
