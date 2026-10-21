import {Meteor} from 'meteor/meteor';
import {LicensesCreate, LicensesSearch, LicensesUpdate} from '/imports/lib/interactors/licenses'

Meteor.methods({
  'Licenses.search': async function (query, options) {
    return await LicensesSearch(query, options);
  },
  // The only write path to the license catalog (company_component_manager).
  'Licenses.Create': LicensesCreate,
  'Licenses.Update': LicensesUpdate
});
