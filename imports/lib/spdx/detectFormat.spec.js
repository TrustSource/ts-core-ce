import {expect} from 'chai';
import detectSpdxFormat from './detectFormat';

describe('detectSpdxFormat', function () {
  const rdf = '<?xml version="1.0"?>\n<rdf:RDF xmlns:spdx="http://spdx.org/rdf/terms#"></rdf:RDF>';
  const rdfNoDecl = '<rdf:RDF xmlns:spdx="http://spdx.org/rdf/terms#"></rdf:RDF>';
  const json = '{"spdxVersion":"SPDX-2.3","name":"x"}';

  it('detects RDF from XML content even when the extension hint is missing', function () {
    // regression: an exported .rdf whose extension hint is lost must still parse as RDF
    expect(detectSpdxFormat(rdf, '')).to.equal('rdf');
    expect(detectSpdxFormat(rdfNoDecl, undefined)).to.equal('rdf');
  });

  it('strips BOM/whitespace before sniffing', function () {
    const bom = String.fromCharCode(0xFEFF);
    expect(detectSpdxFormat(bom + '  ' + rdf, '')).to.equal('rdf');
  });

  it('detects JSON from string and from already-parsed object', function () {
    expect(detectSpdxFormat(json, '')).to.equal('json');
    expect(detectSpdxFormat({spdxVersion: 'SPDX-2.3'}, '')).to.equal('json');
  });

  it('falls back to the extension hint when content is empty', function () {
    expect(detectSpdxFormat('', 'rdf')).to.equal('rdf');
    expect(detectSpdxFormat('', 'xml')).to.equal('rdf');
    expect(detectSpdxFormat('', 'json')).to.equal('json');
    expect(detectSpdxFormat('', '')).to.equal('json');
  });
});
