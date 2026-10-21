import {Meteor} from 'meteor/meteor';
import SPDXFiles from '/imports/lib/collections/SPDXFiles';
import policyFiles from '/imports/lib/collections/policyFiles';

Meteor.startup(async () => {
  /**
   * Clean up incomplete uploads on startup
   * ostrio:files stores metadata differently than CFS
   */
  await SPDXFiles.collection.removeAsync({
    $or: [
      {'versions': {$exists: false}},
      {'versions': {$size: 0}}
    ]
  });

  await policyFiles.collection.removeAsync({
    $or: [
      {'versions': {$exists: false}},
      {'versions': {$size: 0}}
    ]
  });
});
