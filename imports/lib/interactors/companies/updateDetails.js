import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {validateCompanyDetails} from '/imports/lib/companies/companyDetailsInput';
import {logoDataUri, MAX_LOGO_BYTES} from '/imports/lib/companies/companyLogo';
import {httpCall} from '/imports/lib/httpFetch';

// Derive `logoBase64` from the company's logo URL. The URL is user-supplied, so the
// request goes through the SSRF egress guard (every redirect hop is re-checked), gives
// up after 10 seconds and stops reading once the body passes the logo size cap.
// The write is conditional on the URL still being the saved one, so a slow fetch
// for an older URL cannot overwrite the logo of a newer save. Never rejects.
export async function refreshCompanyLogo(companyId, logoUrl) {
  try {
    let logoBase64 = null;
    try {
      const response = await httpCall('GET', logoUrl, {
        validateEgress: true,
        npmRequestOptions: {encoding: null},
        timeoutMs: 10000,
        maxBytes: MAX_LOGO_BYTES
      });
      logoBase64 = logoDataUri(response.content);
    } catch (error) {
      console.log('Company logo could not be fetched:', error.code || error.message);
    }
    const modifier = logoBase64 ? {$set: {logoBase64}} : {$unset: {logoBase64: true}};
    await Companies.updateAsync({_id: companyId, logoUrl}, modifier);
  } catch (error) {
    console.log('Company logo could not be stored:', error.message);
  }
}

const updateDetails = async function (companyId, input) {
  const user = await Meteor.userAsync();
  const userCompanyId = user && user.profile && user.profile.companyId;
  if (typeof companyId !== 'string' || !userCompanyId || userCompanyId !== companyId ||
    !await Roles.userIsInRole(user, ['account_admin'], userCompanyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }

  const details = validateCompanyDetails(input);
  if (details.error) {
    throw new Meteor.Error(400, details.error);
  }

  const modifier = {$set: details.set};
  // A cleared logo URL takes the derived logo with it.
  const cleared = details.unset.indexOf('logoUrl') === -1 ? details.unset : details.unset.concat('logoBase64');
  if (cleared.length) {
    modifier.$unset = {};
    cleared.forEach((field) => {
      modifier.$unset[field] = true;
    });
  }

  const cnt = await Companies.updateAsync(companyId, modifier);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }

  if (details.set.logoUrl) {
    // Not awaited: the save answers at once, and the page shows the logo when it lands
    // (the company publication is reactive).
    refreshCompanyLogo(companyId, details.set.logoUrl);
  }
};

export default updateDetails;
