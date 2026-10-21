import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Utils from '/imports/lib/utils';
import {Meteor} from 'meteor/meteor';

Template.componentSelectorFilter.onRendered(function () {
  const router = Router.current();
  const type = this.data.type
  if (!router.params.query.filter) {
    Session.set('filterSettings' + type)
  } else {
    try {
      let filters = JSON.parse(router.params.query.filter)
      for (const key of Object.keys(filters)) {
        $('#componentSelectorFilter').find('[name='+key+']').val(filters[key])
      }
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (_e) { /* intentionally ignored */ }
    Session.set('filterSettings' + type, router.params.query.filter)
  }
});

Template.componentSelectorFilter.events({

  'click .list_filter .reset_filter': function (event) {
    event.preventDefault();
    let type = this.type
    $('#componentSelectorFilter').find('input')
      .filter(':text, :password, :file').val('')
      .end()
      .end()
      .find('textarea').val('')
      .end()
      .find('select').prop('selectedIndex', 0)
      .find('option:selected').removeAttr('selected')
    Session.set('filterSettings' + type, JSON.stringify({}))
  },

  'input .list_filter .form-control': _.throttle(function (event) {
    event.preventDefault();
    const type = this.type
    let current = Session.get('filterSettings' + type) || '{}'
    if(current){
      current = JSON.parse(current)
    }
    const name = $(event.target).attr('name');
    const value = $(event.target).val().trim();
    if(value){
      current[name] = value
    }else{
      delete current[name]
    }
    const filterString = JSON.stringify(current)
    Session.set('filterSettings' + type, filterString)
  }, 350)
})

Template.componentSelectorFilter.helpers({

  allowedLanguages: function () {
    return Utils.getAllowedLanguages
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }

})
