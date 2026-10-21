import {SearchSource} from 'meteor/meteorhacks:search-source';

const options = {
  // keepHistory: 1000 * 60 * 5,
  keepHistory: false,
  localSearch: true
};

const ComponentSearch = new SearchSource('components', ['key', 'name', 'description'], options);
export default ComponentSearch;
