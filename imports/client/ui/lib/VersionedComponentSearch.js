import {SearchSource} from 'meteor/meteorhacks:search-source';

const options = {
  // keepHistory: 1000 * 60 * 5,
  keepHistory: false,
  localSearch: true
};

const VersionedComponentSearch = new SearchSource('versionedComponents', ['name'], options);
export default VersionedComponentSearch;
