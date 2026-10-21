// https://github.com/spdx/tools
// File was taken and converted from java to js
// https://raw.githubusercontent.com/spdx/tools/master/src/org/spdx/rdfparser/SpdxRdfConstants.java
const SPDX_NAMESPACE = 'http://spdx.org/rdf/terms#';
const PROP_VALUE_NONE = 'none';
const PROP_VALUE_NOASSERTION = 'noassertion';
const PROP_LICENSE_CONCLUDED = 'licenseConcluded';
const PROP_COPYRIGHT_TEXT = 'copyrightText';
const PROP_LIC_COMMENTS = 'licenseComments';
const NON_STD_LICENSE_ID_PRENUM = 'LicenseRef-';
const SPDX_ELEMENT_REF_PRENUM = 'SPDXRef-';
const EXTERNAL_DOC_REF_PRENUM = 'DocumentRef-';

const SpdxRdfConstants = {
  // Namespaces
  RDF_NAMESPACE: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  RDFS_NAMESPACE: 'http://www.w3.org/2000/01/rdf-schema#',
  SPDX_NAMESPACE: SPDX_NAMESPACE,
  DOAP_NAMESPACE: 'http://usefulinc.com/ns/doap#',
  OWL_NAMESPACE: 'http://www.w3.org/2002/07/owl#',
  RDF_POINTER_NAMESPACE: 'http://www.w3.org/2009/pointers#',

  // RDF Properties
  RDF_PROP_TYPE: 'type',
  RDF_PROP_RESOURCE: 'resource',

  // OWL Properties
  PROP_OWL_SAME_AS: 'sameAs',

  // RDFS Properties
  RDFS_PROP_COMMENT: 'comment',
  RDFS_PROP_LABEL: 'label',
  RDFS_PROP_SEE_ALSO: 'seeAlso',

  // DOAP Class Names
  CLASS_DOAP_PROJECT: 'Project',

  // DOAP Project Property Names
  PROP_PROJECT_NAME: 'name',
  PROP_PROJECT_HOMEPAGE: 'homepage',

  // Pointer Class Names
  CLASS_POINTER_START_END_POINTER: 'StartEndPointer',
  CLASS_POINTER_BYTE_OFFSET_POINTER: 'ByteOffsetPointer',
  CLASS_POINTER_LINE_CHAR_POINTER: 'LineCharPointer',

  // Pointer Properties
  PROP_POINTER_START_POINTER: 'startPointer',
  PROP_POINTER_END_POINTER: 'endPointer',
  PROP_POINTER_REFERENCE: 'reference',
  PROP_POINTER_OFFSET: 'offset',
  PROP_POINTER_LINE_NUMBER: 'lineNumber',

  // SPDX Class Names
  CLASS_SPDX_DOCUMENT: 'SpdxDocument',
  CLASS_SPDX_PACKAGE: 'Package',
  CLASS_SPDX_CREATION_INFO: 'CreationInfo',
  CLASS_SPDX_CHECKSUM: 'Checksum',
  CLASS_SPDX_ANY_LICENSE_INFO: 'AnyLicenseInfo',
  CLASS_SPDX_SIMPLE_LICENSE_INFO: 'SimpleLicenseInfo',
  CLASS_SPDX_CONJUNCTIVE_LICENSE_SET: 'ConjunctiveLicenseSet',
  CLASS_SPDX_DISJUNCTIVE_LICENSE_SET: 'DisjunctiveLicenseSet',
  CLASS_SPDX_EXTRACTED_LICENSING_INFO: 'ExtractedLicensingInfo',
  CLASS_SPDX_LICENSE: 'License',
  CLASS_SPDX_LICENSE_EXCEPTION: 'LicenseException',
  CLASS_OR_LATER_OPERATOR: 'OrLaterOperator',
  CLASS_WITH_EXCEPTION_OPERATOR: 'WithExceptionOperator',
  CLASS_SPDX_FILE: 'File',
  CLASS_SPDX_REVIEW: 'Review',
  CLASS_SPDX_VERIFICATIONCODE: 'PackageVerificationCode',
  CLASS_ANNOTATION: 'Annotation',
  CLASS_RELATIONSHIP: 'Relationship',
  CLASS_SPDX_ITEM: 'SpdxItem',
  CLASS_SPDX_ELEMENT: 'SpdxElement',
  CLASS_EXTERNAL_DOC_REF: 'ExternalDocumentRef',
  CLASS_SPDX_EXTERNAL_REFERENCE: 'ExternalRef',
  CLASS_SPDX_REFERENCE_TYPE: 'ReferenceType',
  CLASS_SPDX_SNIPPET: 'Snippet',

  // General SPDX Properties
  PROP_VALUE_NONE: PROP_VALUE_NONE,
  URI_VALUE_NONE: SPDX_NAMESPACE  + PROP_VALUE_NONE,
  PROP_VALUE_NOASSERTION: PROP_VALUE_NOASSERTION,
  URI_VALUE_NOASSERTION: SPDX_NAMESPACE + PROP_VALUE_NOASSERTION,

  // SPDX Document Properties
  // The comment property is the RDFS_PROP_COMMENT property in the rdfs namespace
  PROP_SPDX_REVIEWED_BY: 'reviewed',
  PROP_SPDX_EXTRACTED_LICENSES: 'hasExtractedLicensingInfo',
  PROP_SPDX_VERSION: 'specVersion',
  PROP_SPDX_CREATION_INFO: 'creationInfo',
  PROP_SPDX_PACKAGE: 'describesPackage',
  // @Deprecated		// since 2.0  Planned to be removed in next major spec revision
  PROP_SPDX_FILE_REFERENCE: 'referencesFile',
  PROP_SPDX_DATA_LICENSE: 'dataLicense',
  PROP_SPDX_EXTERNAL_DOC_REF: 'externalDocumentRef',
  SPDX_DOCUMENT_ID: 'SPDXRef-DOCUMENT',

  // SPDX CreationInfo Properties
  // The comment property is the RDFS_PROP_COMMENT property in the rdfs namespace
  PROP_CREATION_CREATOR: 'creator',
  PROP_CREATION_CREATED: 'created', // creation timestamp
  PROP_LICENSE_LIST_VERSION: 'licenseListVersion',
  CREATOR_PREFIX_PERSON: 'Person:',
  CREATOR_PREFIX_ORGANIZATION: 'Organization:',
  CREATOR_PREFIX_TOOL: 'Tool:',

  // SPDX Checksum Properties
  PROP_CHECKSUM_ALGORITHM: 'algorithm',
  PROP_CHECKSUM_VALUE: 'checksumValue',
  ALGORITHM_SHA1: 'SHA1',
  PROP_CHECKSUM_ALGORITHM_SHA1: 'checksumAlgorithm_sha1',

  // SPDX PackageVerificationCode Properties
  PROP_VERIFICATIONCODE_IGNORED_FILES: 'packageVerificationCodeExcludedFile',
  PROP_VERIFICATIONCODE_VALUE: 'packageVerificationCodeValue',

  // SPDX Element Properties
  PROP_ANNOTATION: 'annotation',
  PROP_RELATIONSHIP: 'relationship',

  // SPDX Item Properties
  PROP_LICENSE_CONCLUDED: PROP_LICENSE_CONCLUDED,
  PROP_COPYRIGHT_TEXT: PROP_COPYRIGHT_TEXT,
  PROP_LIC_COMMENTS: PROP_LIC_COMMENTS,
  PROP_LICENSE_DECLARED: 'licenseDeclared',

  // SPDX Package Properties
  PROP_PACKAGE_DECLARED_NAME: 'name',
  PROP_PACKAGE_FILE_NAME: 'packageFileName',
  PROP_PACKAGE_CHECKSUM: 'checksum',
  PROP_PACKAGE_DOWNLOAD_URL: 'downloadLocation',
  PROP_PACKAGE_SOURCE_INFO: 'sourceInfo',
  PROP_PACKAGE_DECLARED_LICENSE: 'licenseDeclared',
  PROP_PACKAGE_CONCLUDED_LICENSE: PROP_LICENSE_CONCLUDED,
  PROP_PACKAGE_DECLARED_COPYRIGHT: PROP_COPYRIGHT_TEXT,
  PROP_PACKAGE_SHORT_DESC: 'summary',
  PROP_PACKAGE_DESCRIPTION: 'description',
  PROP_PACKAGE_FILE: 'hasFile',
  PROP_PACKAGE_VERIFICATION_CODE: 'packageVerificationCode',
  PROP_PACKAGE_LICENSE_INFO_FROM_FILES: 'licenseInfoFromFiles',
  PROP_PACKAGE_LICENSE_COMMENT: 'licenseComments',
  PROP_PACKAGE_VERSION_INFO: 'versionInfo',
  PROP_PACKAGE_ORIGINATOR: 'originator',
  PROP_PACKAGE_SUPPLIER: 'supplier',
  PROP_PACKAGE_FILES_ANALYZED: 'filesAnalyzed',
  PROP_EXTERNAL_REF: 'externalRef',

  // SPDX License Properties
  // The comment property is the RDFS_PROP_COMMENT property in the rdfs namespace
  // the seeAlso property is in the RDFS_PROP_SEE_ALSO property in the rdfs namespace
  PROP_LICENSE_ID: 'licenseId',
  PROP_LICENSE_TEXT: 'licenseText',
  PROP_EXTRACTED_TEXT: 'extractedText',
  PROP_LICENSE_NAME: 'licenseName',
  PROP_STD_LICENSE_NAME_VERSION_1: 'licenseName',	// old property name (pre 1.1 spec)
  PROP_STD_LICENSE_NAME: 'name',
  PROP_STD_LICENSE_URL_VERSION_1: 'licenseSourceUrl',	// This has been replaced with the rdfs:seeAlso property
  PROP_STD_LICENSE_NOTES_VERSION_1: 'licenseNotes',	// old property name (pre 1.1 spec)
  PROP_STD_LICENSE_HEADER_VERSION_1: 'licenseHeader',	// old property name (pre 1.1 spec)
  PROP_STD_LICENSE_NOTICE: 'standardLicenseHeader',
  PROP_STD_LICENSE_TEMPLATE_VERSION_1: 'licenseTemplate',		// old property name (pre 1.2 spec)
  PROP_STD_LICENSE_TEMPLATE: 'standardLicenseTemplate',
  PROP_STD_LICENSE_OSI_APPROVED: 'isOsiApproved',
  PROP_STD_LICENSE_OSI_APPROVED_VERSION_1: 'licenseOsiApproved',	// old property name (pre 1.1 spec)
  PROP_LICENSE_SET_MEMEBER: 'member',
  TERM_LICENSE_NOASSERTION: PROP_VALUE_NOASSERTION,
  TERM_LICENSE_NONE: PROP_VALUE_NONE,
  PROP_LICENSE_EXCEPTION_ID: 'licenseExceptionId',
  PROP_EXAMPLE: 'example',
  PROP_EXCEPTION_TEXT: 'licenseExceptionText',
  PROP_LICENSE_EXCEPTION: 'licenseException',
  PROP_LIC_ID_DEPRECATED: 'isDeprecatedLicenseId',

  // SpdxElement Properties
  PROP_NAME: 'name',

  // SPDX File Properties
  // The comment property is the RDFS_PROP_COMMENT property in the rdfs namespace
  PROP_FILE_NAME: 'fileName',
  PROP_FILE_TYPE: 'fileType',
  PROP_FILE_LICENSE: PROP_LICENSE_CONCLUDED,
  PROP_FILE_COPYRIGHT: PROP_COPYRIGHT_TEXT,
  PROP_FILE_CHECKSUM: 'checksum',
  PROP_FILE_SEEN_LICENSE: 'licenseInfoInFile',
  PROP_FILE_LIC_COMMENTS: PROP_LIC_COMMENTS,
  PROP_FILE_ARTIFACTOF: 'artifactOf',
  PROP_FILE_FILE_DEPENDENCY: 'fileDependency',
  PROP_FILE_CONTRIBUTOR: 'fileContributor',
  PROP_FILE_NOTICE: 'noticeText',

  // SPDX Snippet Properties
  PROP_SNIPPET_FROM_FILE: 'snippetFromFile',
  PROP_SNIPPET_RANGE: 'range',
  PROP_LICENSE_INFO_FROM_SNIPPETS: 'licenseInfoInSnippet',

  // SPDX File Type Properties
  PROP_FILE_TYPE_SOURCE: 'fileType_source',
  PROP_FILE_TYPE_ARCHIVE: 'fileType_archive',
  PROP_FILE_TYPE_BINARY: 'fileType_binary',
  PROP_FILE_TYPE_OTHER: 'fileType_other',

  FILE_TYPE_SOURCE: 'SOURCE',
  FILE_TYPE_ARCHIVE: 'ARCHIVE',
  FILE_TYPE_BINARY: 'BINARY',
  FILE_TYPE_OTHER: 'OTHER',

  // SPDX Annotation Properties
  PROP_ANNOTATOR: 'annotator',
  PROP_ANNOTATION_DATE: 'annotationDate',
  PROP_ANNOTATION_TYPE: 'annotationType',

  // SPDX Relationship Properties
  PROP_RELATED_SPDX_ELEMENT: 'relatedSpdxElement',
  PROP_RELATIONSHIP_TYPE: 'relationshipType',

  // ExternalDocumentRef properties
  PROP_EXTERNAL_DOC_CHECKSUM: 'checksum',
  PROP_EXTERNAL_SPDX_DOCUMENT: 'spdxDocument',
  PROP_EXTERNAL_DOC_ID: 'externalDocumentId',

  // External Reference properties
  PROP_REFERENCE_CATEGORY: 'referenceCategory',
  PROP_REFERENCE_TYPE: 'referenceType',
  PROP_REFERENCE_LOCATOR: 'referenceLocator',

  // SPDX Review Properties
  // NOTE: These have all been deprecated as of SPDX 2.0
  // The comment property is the RDFS_PROP_COMMENT property in the rdfs namespace
  // @Deprecated
  PROP_REVIEW_REVIEWER: 'reviewer',
  // @Deprecated
  PROP_REVIEW_DATE: 'reviewDate',

  // Date format
  SPDX_DATE_FORMAT: 'yyyy-MM-dd HH:mm:ss',// 'yyyy-MM-dd'T'HH:mm:ss'Z'',
  STANDARD_LICENSE_URL: 'http://spdx.org/licenses',

  // license ID format
  NON_STD_LICENSE_ID_PRENUM: NON_STD_LICENSE_ID_PRENUM,
  LICENSE_ID_PATTERN_NUMERIC: NON_STD_LICENSE_ID_PRENUM + '(\\d+)$',	// Pattern for numeric only license IDs
  LICENSE_ID_PATTERN: NON_STD_LICENSE_ID_PRENUM + '([0-9a-zA-Z\\.\\-\\_]+)\\+?$',

  // SPDX Element Reference format
  SPDX_ELEMENT_REF_PRENUM: SPDX_ELEMENT_REF_PRENUM,
  SPDX_ELEMENT_REF_PATTERN: SPDX_ELEMENT_REF_PRENUM + '([0-9a-zA-Z\\.\\-\\+]+)$',

  // External Document ID format
  EXTERNAL_DOC_REF_PRENUM: EXTERNAL_DOC_REF_PRENUM,
  EXTERNAL_DOC_REF_PATTERN: EXTERNAL_DOC_REF_PRENUM + '([0-9a-zA-Z\\.\\-\\+]+)$',
  EXTERNAL_ELEMENT_REF_PATTERN: '(' + EXTERNAL_DOC_REF_PRENUM + '[0-9a-zA-Z\\.\\-\\+]+):(' +
    SPDX_ELEMENT_REF_PRENUM + '[0-9a-zA-Z\\.\\-\\+]+)$',

  SPDX_VERSION_PATTERN: '^SPDX-(\\d+)\\.(\\d+)$',

  // Standard value strings
  NONE_VALUE: 'NONE',
  NOASSERTION_VALUE: 'NOASSERTION',

  // data license ID
  SPDX_DATA_LICENSE_ID_VERSION_1_0: 'PDDL-1.0',
  SPDX_DATA_LICENSE_ID: 'CC0-1.0',

  SPDX_LISTED_REFERENCE_TYPES_PREFIX: 'http://spdx.org/rdf/references/',

  // License XML constants
  LICENSEXML_URI: 'http://www.spdx.org/license',
  LICENSEXML_ELEMENT_LICENSE_COLLECTION: 'SPDXLicenseCollection',
  LICENSEXML_ELEMENT_LICENSE: 'license',
  LICENSEXML_ELEMENT_EXCEPTION: 'exception',
  LICENSEXML_ATTRIBUTE_ID: 'licenseId',
  LICENSEXML_ATTRIBUTE_DEPRECATED: 'isDeprecated',
  LICENSEXML_ATTRIBUTE_DEPRECATED_VERSION: 'deprecatedVersion',
  LICENSEXML_ATTRIBUTE_OSI_APPROVED: 'isOsiApproved',
  LICENSEXML_ATTRIBUTE_NAME: 'name',
  LICENSEXML_ATTRIBUTE_LIST_VERSION_ADDED: 'listVersionAdded',
  LICENSEXML_ELEMENT_CROSS_REFS: 'crossRefs',
  LICENSEXML_ELEMENT_CROSS_REF: 'crossRef',
  LICENSEXML_ELEMENT_NOTES: 'notes',
  LICENSEXML_ELEMENT_STANDARD_LICENSE_HEADER: 'standardLicenseHeader',
  LICENSEXML_ELEMENT_TITLE_TEXT: 'titleText',
  LICENSEXML_ELEMENT_COPYRIGHT_TEXT: 'copyrightText',
  LICENSEXML_ELEMENT_BULLET: 'bullet',
  LICENSEXML_ELEMENT_LIST: 'list',
  LICENSEXML_ELEMENT_ITEM: 'item',
  LICENSEXML_ELEMENT_PARAGRAPH: 'p',
  LICENSEXML_ELEMENT_OPTIONAL: 'optional',
  LICENSEXML_ELEMENT_ALT: 'alt',
  LICENSEXML_ATTRIBUTE_ALT_NAME: 'name',
  LICENSEXML_ATTRIBUTE_ALT_MATCH: 'match',
  LICENSEXML_ELEMENT_BREAK: 'br',

  // custom
  SPDX: 'spdx',
  RDF_RDF: 'rdf:RDF'
};
export default SpdxRdfConstants;
