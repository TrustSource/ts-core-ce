import {js2xml} from './xmlCompat';
import constants from './SPDXRDFConstants';

// helpers
export const element = (name, attributes, elements) => {
  let element = {type: 'element', name: name};
  (elements || !Array.isArray(attributes)) && (element.attributes = attributes);
  (Array.isArray(attributes) || elements) && (element.elements = elements || attributes);
  return element;
};

export const text = (text) => ({type: 'text', text: text});

// root
export const root = (element) => ({elements: [element]});

export const getSPDXID = ({Name, SPDXID}) => (SPDXID ? SPDXID : Name).replace(/[^a-zA-Z.-]+/g, '-');

export const rdf = (DocumentNamespace, Element) => element(
  constants.RDF_RDF,
  {
    'xmlns:spdx': constants.SPDX_NAMESPACE,
    'xmlns:rdf': constants.RDF_NAMESPACE,
    'xmlns': DocumentNamespace,
    'xmlns:doap': constants.DOAP_NAMESPACE,
    'xmlns:rdfs': constants.RDFS_NAMESPACE
  },
  [Element]
);

// classes
// Relationship
export const relationship = (Type, RelationshipElement) => element(`${constants.SPDX}:${constants.PROP_RELATIONSHIP}`, [
  element(`${constants.SPDX}:${constants.CLASS_RELATIONSHIP}`, [
    element(
      `${constants.SPDX}:${constants.PROP_RELATIONSHIP_TYPE}`,
      {'rdf:resource': `${constants.SPDX_NAMESPACE}${constants.PROP_RELATIONSHIP_TYPE}_${Type}`},
      []
    ),
    RelationshipElement
  ])
]);

// RelationshipElement
export const relationshipElement = (attributes, elements) => element(
  `${constants.SPDX}:${constants.PROP_RELATED_SPDX_ELEMENT}`,
  attributes,
  elements
);

// Describes
export const describes = (DocumentNamespace, SPDXID) => relationship('describes',
  relationshipElement({
    'rdf:resource': `${DocumentNamespace}#${constants.SPDX_ELEMENT_REF_PRENUM}${SPDXID}`
  })
);

// Contains
export const contains = (Package) => relationship('contains', relationshipElement([Package]));

// Document
export const document = (DocumentNamespace, elements) => element(
  `${constants.SPDX}:${constants.CLASS_SPDX_DOCUMENT}`,
  {'rdf:about': `${DocumentNamespace}#${constants.SPDX_DOCUMENT_ID}`},
  elements
);

// Document props
export const projectName = (name) => element(`${constants.SPDX}:${constants.PROP_PROJECT_NAME}`, [text(name)]);

export const documentLicense = (licenseId) => element(`${constants.SPDX}:${constants.PROP_SPDX_DATA_LICENSE}`, [license(licenseId)]);

export const version = () => element(`${constants.SPDX}:${constants.PROP_SPDX_VERSION}`, [text('SPDX-2.3')]);

// License
export const license = (licenseId) => element(
  `${constants.SPDX}:${constants.CLASS_SPDX_LICENSE}`,
  {'rdf:about': `${constants.STANDARD_LICENSE_URL}/${licenseId}`},
  [element(`${constants.SPDX}:${constants.PROP_LICENSE_ID}`, [text(licenseId)])]
);

// VerificationCode
export const verificationCode = (VerificationCode) => element(`${constants.SPDX}:${constants.CLASS_SPDX_VERIFICATIONCODE}`, [
  element(`${constants.SPDX}:${constants.PROP_VERIFICATIONCODE_VALUE}`, [text(VerificationCode)])
]);

// CreationInfo
export const creationInfo = ({DateCreated, Organization, Tool}) => element(`${constants.SPDX}:${constants.PROP_SPDX_CREATION_INFO}`, [
  element(`${constants.SPDX}:${constants.CLASS_SPDX_CREATION_INFO}`, [
    element(`${constants.SPDX}:${constants.PROP_CREATION_CREATED}`, [text(DateCreated)]),
    element(`${constants.SPDX}:${constants.PROP_CREATION_CREATOR}`, [text(`${constants.CREATOR_PREFIX_ORGANIZATION} ${Organization}`)]),
    element(`${constants.SPDX}:${constants.PROP_LICENSE_LIST_VERSION}`, [text('2.5')]),
    element(`${constants.SPDX}:${constants.PROP_CREATION_CREATOR}`, [text(`${constants.CREATOR_PREFIX_TOOL} ${Tool}`)])
  ])
]);

// Checksum
export const checksum = (Checksum) => element(
  `${constants.SPDX}:${constants.CLASS_SPDX_CHECKSUM}`,
  [
    element(`${constants.SPDX}:${constants.PROP_CHECKSUM_VALUE}`, [text(Checksum)]),
    element(`${constants.SPDX}:${constants.PROP_CHECKSUM_ALGORITHM}`, {
      'rdf:resource': `${constants.SPDX_NAMESPACE}${constants.PROP_CHECKSUM_ALGORITHM_SHA1}`
    })
  ]
);

// File
export const file = (DocumentNamespace, {Name, FileName, Checksum, CopyrightText, licenseId, licenseConcluded}) => element(
  `${constants.SPDX}:${constants.CLASS_SPDX_FILE}`,
  {'rdf:about': `${DocumentNamespace}#${constants.SPDX_ELEMENT_REF_PRENUM}${Name}`},
  [
    element(`${constants.SPDX}:${constants.PROP_FILE_CHECKSUM}`, [checksum(Checksum)]),
    element(`${constants.SPDX}:${constants.PROP_FILE_COPYRIGHT}`, [text(CopyrightText)]),
    element(`${constants.SPDX}:${constants.PROP_FILE_SEEN_LICENSE}`, [license(licenseId)]),
    element(`${constants.SPDX}:${constants.PROP_FILE_LICENSE}`, {'rdf:resource': `${constants.STANDARD_LICENSE_URL}/${licenseConcluded}`}),
    element(`${constants.SPDX}:${constants.PROP_FILE_NAME}`, [text(FileName)])
  ]
);

// Package
export const packageElement = (DocumentNamespace, {
  Name, SPDXID, LicenseId, DownloadURL, Homepage, Version, VerificationCode, CopyrightText, LicenseIdFromFile,
  LicenseIdDeclared, Description, Files, Packages
}) => element(
  `${constants.SPDX}:${constants.CLASS_SPDX_PACKAGE}`,
  {'rdf:about': `${DocumentNamespace}#${constants.SPDX_ELEMENT_REF_PRENUM}${getSPDXID({Name, SPDXID})}`},
  (Packages || [])
    .map(Package => contains(packageElement(DocumentNamespace, Package)))
    .concat([
      Name && element(`${constants.SPDX}:${constants.PROP_PACKAGE_DECLARED_NAME}`, [text(Name)]),
      Version && element(`${constants.SPDX}:${constants.PROP_PACKAGE_VERSION_INFO}`, [text(Version)]),
      DownloadURL && element(`${constants.SPDX}:${constants.PROP_PACKAGE_DOWNLOAD_URL}`, [text(DownloadURL)]),
      LicenseId && element(
        `${constants.SPDX}:${constants.PROP_PACKAGE_CONCLUDED_LICENSE}`,
        {'rdf:resource': `${constants.STANDARD_LICENSE_URL}/${LicenseId}`}
      ),
      VerificationCode && element(`${constants.SPDX}:${constants.PROP_PACKAGE_VERIFICATION_CODE}`, [verificationCode(VerificationCode)]),
      Homepage && element(`doap:${constants.PROP_PROJECT_HOMEPAGE}`, [text(Homepage)]),
      CopyrightText && element(`${constants.SPDX}:${constants.PROP_PACKAGE_DECLARED_COPYRIGHT}`, [text(CopyrightText)]),
      element(`${constants.SPDX}:${constants.PROP_PACKAGE_FILES_ANALYZED}`, [text('false')]),
      Files ? element(`${constants.SPDX}:${constants.PROP_PACKAGE_FILE}`, Files.map(File => file(DocumentNamespace, File))) : null,
      LicenseIdFromFile && element(
        `${constants.SPDX}:${constants.PROP_PACKAGE_LICENSE_INFO_FROM_FILES}`,
        {'rdf:resource': `${constants.STANDARD_LICENSE_URL}/${LicenseIdFromFile}`}
      ),
      LicenseIdDeclared && element(
        `${constants.SPDX}:${constants.PROP_PACKAGE_DECLARED_LICENSE}`,
        {'rdf:resource': `${constants.STANDARD_LICENSE_URL}/${LicenseIdDeclared}`}
      ),
      Description && element(`${constants.PROP_PACKAGE_DESCRIPTION}`, [text(Description)])
    ].filter(item => item))
);

export const generate = ({DocumentNamespace, Name, CreationInfo, Package}) => {
  const LicenseId = 'CC0-1.0';
  const jsResult = root(
    rdf(
      DocumentNamespace,
      document(DocumentNamespace, [
        contains(packageElement(DocumentNamespace, Package)),
        describes(DocumentNamespace, getSPDXID({Name: Package.Name, SPDXID: Package.SPDXID})),
        projectName(Name),
        documentLicense(LicenseId),
        version(),
        creationInfo(CreationInfo)
      ])
    )
  );
  return js2xml(jsResult, {spaces: 2});
};

export default generate;
