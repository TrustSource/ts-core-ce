import {Meteor} from 'meteor/meteor';
import Updates from '/imports/lib/collections/updates';

const view = async function (_id, filter) {
  const user = await Meteor.userAsync();
  if (!user) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const query = filter ? filter : {_id: _id, viewedBy: { $ne: user._id }};
  return await Updates.updateAsync(query, {$push: {viewedBy: user._id}})
};

export default view;
