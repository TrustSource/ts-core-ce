/* eslint-disable no-undef */
// Integration-level unit test for the export contract behind the new SBOM-details
// BOM-type dropdown. The helper spec (sbom-details-helpers.unit.spec.js)
// only proves the dropdown maps a clicked variant string to a getCycloneDxDetails
// `type` argument + filename suffix; it does NOT prove that the chosen `type`
// actually yields a different document. This spec closes that gap by requiring the
// real CycloneDX writer (imports/lib/cyclonedx/writer.js - pure CommonJS, no Meteor)
// and asserting buildDocument(report, variant) emits the right component classes:
//
//   * AIBOM  -> machine-learning-model component(s), NO software libraries  (PM AC #9)
//   * SBOM   -> software libraries only, NO ML model and NO crypto asset    (AC #10)
//   * CBOM   -> cryptographic-asset only                                    (AC #10)
//   * FULL   -> combined: libraries + crypto + ML (variant === undefined)   (AC #10)
//
// i.e. clicking "AIBOM" really produces an AI/ML BOM and "Full BOM" stays combined,
// not just that the click is wired to the right string. The fixture is the minimal
// dependency tree the writer's walk() needs: a library whose `key` yields a purl
// (so it gets a bom-ref and is emitted), carrying one ai_models marker and one
// crypto_algorithms marker, plus a nested child library.
const writer = require('../../imports/lib/cyclonedx/writer');
const E = require('../../imports/lib/cyclonedx/enums');

// Minimal, realistic report. `key` must be `manager:name` with a non-internal
// manager so getPackageUrl() returns a purl -> the library gets a bom-ref and is
// pushed (libraries with a null bom-ref are silently skipped by walk()).
function makeReport() {
  return {
    tree: {
      dependencies: [
        {
          name: 'ml-app',
          key: 'npm:ml-app',
          version: '2.0.0',
          crypto_algorithms: [{algorithm: 'AES'}],
          ai_models: [{
            name: 'bert-base',
            version: '1.0',
            provider: 'HuggingFace',
            task: 'text-classification',
            purl: 'pkg:huggingface/bert-base@1.0'
          }],
          dependencies: [
            {name: 'left-pad', key: 'npm:left-pad', version: '1.3.0'}
          ]
        }
      ]
    }
  };
}

function typesOf(doc) {
  return doc.components.map((c) => c.type);
}

function namesOf(doc) {
  return doc.components.map((c) => c.name);
}

describe('cyclonedx writer - BOM-type variants behind the SBOM-details dropdown', () => {
  describe("AIBOM variant (PM AC #9 - 'AIBOM' menu item yields an AI/ML BOM)", () => {
    it('emits machine-learning-model component(s) and excludes software libraries', () => {
      const doc = writer.buildDocument(makeReport(), 'AIBOM');
      const types = typesOf(doc);
      expect(types).toContain(E.ML_ASSET_TYPE); // 'machine-learning-model'
      expect(types).not.toContain('library');
      expect(types).not.toContain('cryptographic-asset');
    });

    it('carries the ai_models marker through (name/type) so the file is a real AIBOM', () => {
      const doc = writer.buildDocument(makeReport(), 'AIBOM');
      const ml = doc.components.find((c) => c.type === E.ML_ASSET_TYPE);
      expect(ml).toBeDefined();
      expect(ml.name).toBe('bert-base');
    });
  });

  describe('SBOM variant (AC #10 - existing software BOM output unchanged)', () => {
    it('emits software libraries only - no ML model, no crypto asset', () => {
      const doc = writer.buildDocument(makeReport(), 'SBOM');
      const types = typesOf(doc);
      expect(types).toContain('library');
      expect(types).not.toContain(E.ML_ASSET_TYPE);
      expect(types).not.toContain('cryptographic-asset');
    });

    it('includes both the parent and the nested child library', () => {
      const doc = writer.buildDocument(makeReport(), 'SBOM');
      expect(namesOf(doc)).toEqual(expect.arrayContaining(['ml-app', 'left-pad']));
    });
  });

  describe('CBOM variant (AC #10 - crypto BOM output unchanged)', () => {
    it('emits cryptographic-asset only - no library, no ML model', () => {
      const doc = writer.buildDocument(makeReport(), 'CBOM');
      const types = typesOf(doc);
      expect(types).toContain('cryptographic-asset');
      expect(types).not.toContain('library');
      expect(types).not.toContain(E.ML_ASSET_TYPE);
    });
  });

  describe("FULL / combined variant (AC #10 - 'Full BOM' stays combined)", () => {
    it('includes libraries, crypto assets AND ML models when variant is undefined', () => {
      const doc = writer.buildDocument(makeReport(), undefined);
      const types = typesOf(doc);
      expect(types).toContain('library');
      expect(types).toContain('cryptographic-asset');
      expect(types).toContain(E.ML_ASSET_TYPE);
    });

    it('is a strict superset of the SBOM + CBOM + AIBOM components', () => {
      const full = new Set(namesOf(writer.buildDocument(makeReport(), undefined)));
      const sbom = namesOf(writer.buildDocument(makeReport(), 'SBOM'));
      const cbom = namesOf(writer.buildDocument(makeReport(), 'CBOM'));
      const aibom = namesOf(writer.buildDocument(makeReport(), 'AIBOM'));
      [...sbom, ...cbom, ...aibom].forEach((name) => {
        expect(full.has(name)).toBe(true);
      });
    });
  });

  describe('variant isolation - selecting one BOM type never leaks another', () => {
    it('AIBOM and SBOM share no component names for this fixture', () => {
      const aibom = namesOf(writer.buildDocument(makeReport(), 'AIBOM'));
      const sbom = namesOf(writer.buildDocument(makeReport(), 'SBOM'));
      const overlap = aibom.filter((n) => sbom.indexOf(n) !== -1);
      expect(overlap).toEqual([]);
    });

    it('every emitted document is a valid CycloneDX envelope with a components array', () => {
      ['SBOM', 'CBOM', 'AIBOM', undefined].forEach((variant) => {
        const doc = writer.buildDocument(makeReport(), variant);
        expect(doc.bomFormat).toBe('CycloneDX');
        expect(doc.specVersion).toBe(E.SPEC_VERSION);
        expect(Array.isArray(doc.components)).toBe(true);
      });
    });
  });
});
