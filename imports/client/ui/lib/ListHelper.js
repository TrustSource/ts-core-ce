import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import Utils from '/imports/lib/utils';

function indexOf(list, compareObj, compareKeys) {
  if (list instanceof Array) {
    let newIdx;
    list.forEach(function (obj, index) {
      if (newIdx === undefined) {
        const pickedObj = _.pick(obj, compareKeys);
        if (_.isEqual(pickedObj, compareObj)) {
          newIdx = index;
        }
      }
    });
    return newIdx;
  }
  return -1;
}

function isDuplicate(list, currentIdx, compare, assocList) {

  if (!(list instanceof Array)) {
    return false;   // nothing to compare
  }

  const compareKeys = _.keys(compare);
  const newIdx = indexOf(list, compare, compareKeys);
  currentIdx = parseInt(currentIdx);   // ensure string

  if (newIdx >= 0 && newIdx !== currentIdx) {
    // duplicate:  if (Found and newIndex != currentIndex)
    return true;
  }

  if (assocList instanceof Array) {
    const assocIdx = indexOf(assocList, compare, compareKeys);
    return assocIdx >= 0;
  } else {
    return false; // nothing to compare
  }
}

// `index` is a display-only position handed to the row template (id="select-{{index}}" and the
// row-click selection). It is not part of any list entry schema, and it used to reach MongoDB
// because the list helpers stamped it straight onto the documents they were rendering. Strip it
// here so storage never sees it, whatever a caller passes in.
function withoutDisplayFields(entry) {
  return _.omit(entry, 'index');
}

// Entries are stored alphabetically by the same value the list is sorted on for display, so the
// stored order is deterministic instead of depending on the order rows happened to be added.
function entrySortValue(entry) {
  const value = entry && (entry.key || entry.cveKey || entry.obligationKey || entry.name || '');
  return String(value).toLowerCase();
}

export const ListHelper = {
  clearSession: function clearSession(id) {
    Session.set(id + 'ErrorMsg', undefined);
    Session.set(id + 'SelIdx', undefined);
  },

  // Prepare a list for `updateCollection` / `updateUserConfig`: no display-only fields, sorted
  // alphabetically. Returns copies, so the caller's array (a live Minimongo document) is untouched.
  forStorage: function forStorage(list) {
    if (!(list instanceof Array)) return list;
    return _.sortBy(_.map(list, withoutDisplayFields), entrySortValue);
  },

  // A render-time copy carrying the display-only `index`, so helpers can hand the template a
  // position without writing to the underlying document.
  withDisplayIndex: function withDisplayIndex(entry, index) {
    return Object.assign({}, entry, {index: index});
  },

  getSelectedIndex: function getSelectedIndex(id, data) {
    const selectedIndex = Session.get(id + 'SelIdx');
    return (selectedIndex >= 0 && data instanceof Array && selectedIndex < data.length) ? selectedIndex : undefined;
  },

  getOnSubmitHook: function getOnSubmitHook(compareKeys, checkRegExp, userUpdate, requireWhitelist) {
    const self = this;
    const user = Meteor.user();

    return function (insertDoc, updateDoc, currentDoc) {
      try {
        if(requireWhitelist && !Roles.userIsInRole(user._id, 'compliance_manager', user.profile.companyId)){
          insertDoc.approved = false;
        }
        // TODO This fix related to problem with afQuickField and value mapping if value contains .
        insertDoc.key = insertDoc.key ? insertDoc.key.replace(/__DOT__/g, '.') : insertDoc.key
        if(!insertDoc.key){
          delete insertDoc.key
        }
        const formContext = Template.parentData(1);
        delete insertDoc.index;

        if (checkRegExp && (!Utils.ComponentRegExp.check(insertDoc.key) || !Utils.ComponentRegExp.check(insertDoc.version))) {
          // console.log('Regex error');
          Session.set(formContext.id + 'ErrorMsg', 'Invalid regular expression');
          this.done();

        } else if (isDuplicate(formContext.data, currentDoc.index, _.pick(insertDoc, compareKeys), formContext.assocData)) {
          // console.log('Duplicate');
          Session.set(formContext.id + 'ErrorMsg', 'Entry already exists');
          this.done();

        } else {
          const data = formContext.data || [];
          const originalData = _.reject(data, function (elem) {
            return elem.projectItem === true || elem.companyItem === true;
          }) || [];
          if (currentDoc.index >= 0 && currentDoc.index < data.length) {
            data[currentDoc.index] = insertDoc;
          } else {
            data.push(insertDoc);
          }
          const dataWithout = self.forStorage(_.reject(data, function (elem) {
            return elem.projectItem === true || elem.companyItem === true;
          }) || []);
          if (userUpdate) {
            Meteor.callAsync('updateUserConfig', formContext.attribute, dataWithout).catch(function (error) {
              console.log(error);
            });
          } else {
            Meteor.callAsync('updateCollection', formContext.collection._name, formContext.docId, formContext.attribute,
              dataWithout, true, originalData);
          }
          if(requireWhitelist && !Roles.userIsInRole(user._id, 'compliance_manager', user.profile.companyId)){
            let itemType = formContext.collection._name;
            let itemName = formContext.collection.findOne(formContext.docId).name;
            Meteor.callAsync('notifyAboutWhiteListed',user,insertDoc,insertDoc.comment,itemType,itemName)
          }
          self.clearSession(formContext.id);
          this.done();
        }
      } catch (error) {   // catch errors and prevent default submit handling by returning false in every case
        // console.log('Error in onSubmit()', error);
        Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'markError');
        this.done(new Error('Submission failed'));
      }
      return false;
    };
  },

  getOnErrorHook: function getOnErrorHook() {
    return function () {
    // return function (formType, error) {
      // console.log('onError', formType, error);
    };
  }
};
