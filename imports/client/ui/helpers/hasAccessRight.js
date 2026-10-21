import {Template} from 'meteor/templating';
import UserExtUtils from '/imports/lib/userExtUtils';

Template.registerHelper('hasAccessRight', function (permission, right, entity) {
  return UserExtUtils.hasAccessRight(permission, right, entity);
});
