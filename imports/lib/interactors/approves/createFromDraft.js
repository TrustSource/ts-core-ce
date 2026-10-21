import {Meteor} from 'meteor/meteor';
import Approves from '/imports/lib/collections/approves';
import ApprovesCreate from './create';
import ApprovesRemove from './remove';

const createFromDraft = async function (draftId) {
  // Only let the caller promote a draft approval that belongs to their company.
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof draftId !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  let draft = await Approves.findOneAsync({_id: draftId, companyId});
  if (!draft) {
    throw new Meteor.Error(404, 'Not found');
  }
  draft.draft = false;
  // Promoting a draft is a browser-wizard path: run the heavy generation
  // chain in the background so the UI returns immediately (REST omits this flag
  // and stays synchronous).
  draft.background = true;
  let approveId = await ApprovesCreate(draft);
  if(approveId){
    await ApprovesRemove(draftId)
  }
  return approveId
};

export default createFromDraft;
