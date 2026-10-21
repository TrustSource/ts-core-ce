import {Meteor} from 'meteor/meteor';
import SPDXExports from '/imports/lib/collections/SPDXExports';
import Modules from '/imports/lib/collections/modules';
import generate from '/imports/lib/interactors/SPDXExports/generate';
import uuid from 'uuid';

const create = async function ({moduleId}) {
  // Only export a module the caller's company owns; never trust client userId.
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || typeof moduleId !== 'string'
    || !await Modules.findOneAsync({_id: moduleId, companyId}, {fields: {_id: 1}})) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const doc = {
    uuid: uuid.v4(),
    userId: user._id,
    moduleId,
    rdfFileId: null,
    txtFileId: null,
    xlsFileId: null,
    status: 'created',
    created: new Date(),
    updated: new Date()
  };
  const objectId = await SPDXExports.insertAsync(doc);
  if (objectId) generate(objectId);
};

export default create;
