import {Meteor} from 'meteor/meteor';
import RiskProperties from '/imports/lib/collections/riskProperties';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';


const filter = async function (params) {
  const user = await Meteor.userAsync();
  // Authenticated client calls are scoped to their own company; only trusted
  // server-side calls (no DDP user) may supply a companyId.
  const companyId = user ? (user.profile && user.profile.companyId) : (params && params.companyId);
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // The risk portfolio views legitimately pass query operators ($and/$ne/$gte),
  // so keep them but strip server-side-JS operators ($where/$function/...).
  const query = stripDangerousOperators(params || {});
  query.companyId = companyId;
  return await RiskProperties.find(query).fetchAsync();
};

export default filter;
