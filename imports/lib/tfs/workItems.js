/* global Promise:false */

const SYS_PROJECT = 'System.TeamProject'
const SYS_ITEM = 'System.WorkItemType'

const WorkItems = (connect) => {
  const api = connect.getWorkItemTrackingApi();
  const findStateColor = (cache, project, type, state) => {
    if (cache[project] && cache[project][type]) {
      const stateObj = (cache[project][type] || []).find(item => item.name === state);
      return stateObj ? stateObj : false;
    }
    return false;
  };
  const setStateColor = (workItem, state) => {
    workItem.fields['System.StateColor'] = `#${state.color}`;
    return workItem;
  };
  const setBoardUrl = (workItem) => {
    const url = workItem.url.match(/^(https?:\/\/|)[^/]*/)[0];
    const project = workItem.fields[SYS_PROJECT];
    workItem.boardUrl = `${url}/${project}/_workitems?id=${workItem.id}&_a=edit&fullScreen=true`;
    return workItem;
  };
  const setAdditionalInfo = (cache, workItem) => {
    const type = workItem.fields[SYS_ITEM];
    const project = workItem.fields[SYS_PROJECT];
    const state = workItem.fields['System.State'];
    return setStateColor(setBoardUrl(workItem), findStateColor(cache, project, type, state) || {color: 'b2b2b2'});
  };
  const getWorkItemTypeStatesCachePromise = (workItems) => {
    return Promise.all(
      workItems.filter((workItem, start) => {
        for (let i = start + 1; i < workItems.length; i++) {
          if (workItems[i].fields[SYS_PROJECT] === workItem.fields[SYS_PROJECT] &&
            workItems[i].fields[SYS_ITEM] === workItem.fields[SYS_ITEM]) {
            return false;
          }
        }
        return true;
      }).map((workItem) => {
        const project = workItem.fields[SYS_PROJECT];
        const type = workItem.fields[SYS_ITEM];
        return api.getWorkItemTypeStates(project, type).then((data) => [project, type, data]);
      })
    ).then((cacheArr) => {
      let cache = {};
      cacheArr.forEach(([project, type, data]) => {
        cache[project] = cache[project] || {};
        cache[project][type] = data;
      });
      return cache;
    });
  };
  const setAdditionalInfoWorkItem = (workItem, callback) => {
    getWorkItemTypeStatesCachePromise([workItem])
      .then((cache) => callback(null, setAdditionalInfo(cache, workItem)))
      .catch((error) => callback(error));
  };
  const setAdditionalInfoWorkItems = (workItems, callback) => {
    getWorkItemTypeStatesCachePromise(workItems)
      .then((cache) => callback(null, workItems.map((workItem) => setAdditionalInfo(cache, workItem))))
      .catch((error) => callback(error));
  };
  return {
    getAll(project, {Tag}, callback) {
      let query = 'Select [System.Id] FROM WorkItems';
      if (Tag) {
        query += ` WHERE [System.Tags] Contains '${Tag}'`;
      }
      api.queryByWiql({query: query}, {project}).then(r => api.getWorkItems(r.workItems.map(({id}) => id))
        .then(r => setAdditionalInfoWorkItems(r, callback))
        .catch(e => callback(e))
      ).catch(e => callback(e));
    },
    get(id, callback) {
      api.getWorkItem(id).then(r => setAdditionalInfoWorkItem(r, callback)).catch(e => callback(e))
    },
    create(project, type, {Title, Description, ReproSteps, Tag}, callback) {
      const document = [
        Title && {
          op: 'add',
          path: '/fields/System.Title',
          value: Title
        },
        Description && {
          op: 'add',
          path: '/fields/System.Description',
          value: Description
        },
        ReproSteps && {
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.ReproSteps',
          value: ReproSteps
        },
        Tag && {
          op: 'add',
          path: '/fields/System.Tags',
          value: Tag
        }
      ].filter(op => op);
      api.createWorkItem(null, document, project, type).then(r => setAdditionalInfoWorkItem(r, callback)).catch(e => callback(e));
    },
    update(id, {Title, Description, ReproSteps, Tag}, callback) {
      const document = [
        Title && {
          op: 'replace',
          path: '/fields/System.Title',
          value: Title
        },
        Description && {
          op: 'replace',
          path: '/fields/System.Description',
          value: Description
        },
        ReproSteps && {
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.ReproSteps',
          value: ReproSteps
        },
        Tag && {
          op: 'replace',
          path: '/fields/System.Tags',
          value: Tag
        }
      ].filter(op => op);
      api.updateWorkItem(null, document, id).then(r => setAdditionalInfoWorkItem(r, callback)).catch(e => callback(e));
    },
    delete(id, callback) {
      api.deleteWorkItem(id).then(r => callback(null, r)).catch(e => callback(e));
    },
    getTypes(project, callback) {
      api.getWorkItemTypes(project).then(r => callback(null, r)).catch(e => callback(e));
    },
    getTypeStates(project, type, callback) {
      api.getWorkItemTypeStates(project, type).then(r => callback(null, r)).catch(e => callback(e));
    }
  }
};

export default WorkItems;
