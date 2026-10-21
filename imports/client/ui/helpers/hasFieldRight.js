import {Template} from 'meteor/templating';
import UserExtUtils from '/imports/lib/userExtUtils';

Template.registerHelper('hasFieldRight', function (permission, entity) {
  return {
    read: UserExtUtils.hasAccessRight(permission, 'r', entity),
    disabled: !UserExtUtils.hasAccessRight(permission, 'w', entity),
    execute: UserExtUtils.hasAccessRight(permission, 'x', entity),
    delete: UserExtUtils.hasAccessRight(permission, 'd', entity)
  };
});
