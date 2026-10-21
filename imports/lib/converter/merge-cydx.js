import cydxWriter from '/imports/lib/cyclonedx/writer';

const mergeCycloneDX = async function (sboms) {
  return cydxWriter.merge(sboms);
};

export default mergeCycloneDX;
