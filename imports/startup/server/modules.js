import {Meteor} from 'meteor/meteor';
import {ModulesAnalyzeWithoutScan, ModulesCreate, ModulesUpdateEndoflifePolicy,
  ModulesUpdateRequirements, ModulesUpdateViabilityConfig, ModulesUpdateCiaRequirements,
  ModulesUpdateObligationConfig, ModulesUpdateVersioningConfig,
  ModulesUpdateCustomComponents, ModulesUpdateCommercialTerms, ModulesUpdateEnvironmentalConfig,
  ModulesUpdateRelease, ModulesUpdatePinnedBy, ModulesArchive, ModulesRemove,
  ModulesResolveComponentLicense, ModulesClearComponentLicenseResolution}
  from '/imports/lib/interactors/modules'

Meteor.methods({
  'Modules.Create': ModulesCreate,
  'Modules.AnalyzeWithoutScan': ModulesAnalyzeWithoutScan,
  'Modules.UpdateEndoflifePolicy': ModulesUpdateEndoflifePolicy,
  'Modules.UpdateRequirements': ModulesUpdateRequirements,
  'Modules.UpdateViabilityConfig': ModulesUpdateViabilityConfig,
  'Modules.UpdateCiaRequirements': ModulesUpdateCiaRequirements,
  'Modules.UpdateObligationConfig': ModulesUpdateObligationConfig,
  'Modules.UpdateVersioningConfig': ModulesUpdateVersioningConfig,
  'Modules.UpdateCustomComponents': ModulesUpdateCustomComponents,
  'Modules.UpdateCommercialTerms': ModulesUpdateCommercialTerms,
  'Modules.UpdateEnvironmentalConfig': ModulesUpdateEnvironmentalConfig,
  'Modules.UpdateRelease': ModulesUpdateRelease,
  'Modules.UpdatePinnedBy': ModulesUpdatePinnedBy,
  'Modules.Archive': ModulesArchive,
  'Modules.Remove': ModulesRemove,
  // Exactly the declared arguments are forwarded, spelled out rather
  // than `...args`: a further argument from a DDP client is where companyId and
  // the acting user would get injected, and both are derived server-side from
  // the session.
  'Modules.ResolveComponentLicense': async function (moduleId, componentKey, license, justification) {
    return await ModulesResolveComponentLicense(moduleId, componentKey, license, justification);
  },
  'Modules.ClearComponentLicenseResolution': async function (moduleId, componentKey) {
    return await ModulesClearComponentLicenseResolution(moduleId, componentKey);
  }
});
