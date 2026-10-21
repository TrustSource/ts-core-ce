import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';

Template.componentListSorting.onRendered(function () {
  const router = Router.current();
  const type = this.data.type
  if (!router.params.query.sorting) {
    Session.set('sortingSettings' + type)
  } else {
    let filters = JSON.parse(router.params.query.sorting)
    for (const key of Object.keys(filters)) {
      $('#componentListSorting').find('[name='+key+']').val(filters[key])
    }
    Session.set('sortingSettings' + type, router.params.query.sorting)
  }
});

Template.componentListSorting.events({

  'input .form-control': _.throttle(function (event) {
    event.preventDefault();
    const type = this.type
    let current = Session.get('sortingSettings' + type) || '{}'
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
    Session.set('sortingSettings' + type, filterString)
    let newUrl = Router.current().route.path({}, {query: {'sorting': filterString}});
    Router.go(newUrl);
  }, 350)
})

Template.componentListSorting.helpers({

  availableSorting: function () {
    return [{
      key:'',
      label: 'Name'
    },{
      key:'key',
      label: 'Key'
    },{
      key:'language',
      label: 'Language'
    },{
      key:'description',
      label: 'Description'
    }]
  }

})
