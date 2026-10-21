import {Meteor} from 'meteor/meteor';
import {
  CompaniesUpdateTfs, CompaniesUpdateJira, CompaniesUpdateGithub, CompaniesUpdateScanoss,
  CompaniesUpdateEndoflifePolicy, CompaniesUpdateDetails, CompaniesUpdateFoss,
  CompaniesUpdateLeanix, CompaniesUpdateGeneralSettings, CompaniesUpdateWrittenOffer,
  CompaniesUpdatePsirt, CompaniesUpdateRequireWhitelist,
  CompaniesUpdateDefaultRootComponentLicense
} from '/imports/lib/interactors/companies'

Meteor.methods({
  'Companies.UpdateTfs': CompaniesUpdateTfs,
  'Companies.UpdateGithub': CompaniesUpdateGithub,
  'Companies.UpdateJira': CompaniesUpdateJira,
  'Companies.UpdateScanoss': CompaniesUpdateScanoss,
  'Companies.UpdateEndoflifePolicy': CompaniesUpdateEndoflifePolicy,
  'Companies.UpdateDetails': CompaniesUpdateDetails,
  'Companies.UpdateFoss': CompaniesUpdateFoss,
  'Companies.UpdateLeanix': CompaniesUpdateLeanix,
  'Companies.UpdateGeneralSettings': CompaniesUpdateGeneralSettings,
  'Companies.UpdateWrittenOffer': CompaniesUpdateWrittenOffer,
  'Companies.UpdatePsirt': CompaniesUpdatePsirt,
  'Companies.UpdateRequireWhitelist': CompaniesUpdateRequireWhitelist,
  'Companies.UpdateDefaultRootComponentLicense': CompaniesUpdateDefaultRootComponentLicense
});
