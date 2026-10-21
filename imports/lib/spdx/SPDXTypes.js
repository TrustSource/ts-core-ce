// The Community Edition imports and exports SPDX as RDF. The tag-value (.txt) and
// spreadsheet (.xls) formats needed an external SPDX-tools service to convert them to
// RDF first, so they are not offered here.
const SPDXtypes = {
  rdf:  {
    ext: '.rdf',
    fileType: 'application/rdf+xml'
  }
};

export default SPDXtypes;
