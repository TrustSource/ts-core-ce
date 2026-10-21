import * as vsts from 'azure-devops-node-api';
import WorkItems from './workItems';
import collectionUrl from './collectionUrl'

const tfs = ({account, token}) => {
  const authHandler = vsts.getPersonalAccessTokenHandler(token);
  const connect = new vsts.WebApi(collectionUrl(account), authHandler);

  return {
    getWorkItems() {
      return WorkItems(connect);
    }
  };
};

export {default as collectionUrl} from './collectionUrl'
export default tfs;
