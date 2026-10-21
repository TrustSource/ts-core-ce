import {Meteor} from 'meteor/meteor';
import ComponentLogs from '/imports/lib/collections/componentLogs';

const MAX_LOG_ENTRIES_PER_COMPONENT = 10;

Meteor.methods({
  'ComponentLogs.Create': async function (params) {
    let doc = {
      created: new Date(),
      createdBy: params.createdBy,
      componentKey: params.componentKey,
      companyId: params.companyId,
      version: typeof params.version === 'string' && params.version !== '{}' ? params.version : null,
      componentId: params.componentId,
      text: params.text
    };
    let componentModification = await ComponentLogs.insertAsync(doc);
    if(componentModification){
      // Keep only the newest MAX_LOG_ENTRIES_PER_COMPONENT entries per component
      let excess = await ComponentLogs.find(
        {componentId: doc.componentId},
        {sort: {created: -1}, skip: MAX_LOG_ENTRIES_PER_COMPONENT, fields: {_id: 1}, transform: null}
      ).fetchAsync();
      if (excess.length) {
        await ComponentLogs.removeAsync({_id: {$in: excess.map(function (entry) { return entry._id; })}});
      }
      return componentModification
    }else{
      return false
    }
  }
});
