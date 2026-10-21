// The license search pattern (Licenses.search and the highlight helper). The builder lives
// next to containsTextRegex so the escaping is shared and Jest can test it directly.
import {searchTermsRegExp} from '/imports/lib/security/searchRegex';

export default searchTermsRegExp;
