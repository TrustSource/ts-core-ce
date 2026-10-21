import {Meteor} from 'meteor/meteor';
import {RiskPropertiesCreate, RiskPropertiesRemove, RiskPropertiesUpdate,
  RiskPropertiesFind, RiskPropertiesFindOne, RiskPropertiesCountermeasuresFind,
  RiskPropertiesGetPortfolio, RiskPropertiesFilter, RiskPropertiesFindOneById,
  RiskPropertiesReconcileFromSarif} from '/imports/lib/interactors/riskProperties';

Meteor.methods({
  'RiskProperties.Create': RiskPropertiesCreate,
  'RiskProperties.Update': RiskPropertiesUpdate,
  'RiskProperties.Remove': RiskPropertiesRemove,
  'RiskProperties.Find': async function (...args) { return await RiskPropertiesFind.apply(this, args); },
  'RiskProperties.FindOne': async function (...args) { return await RiskPropertiesFindOne.apply(this, args); },
  'RiskProperties.FindOneById': async function (...args) { return await RiskPropertiesFindOneById.apply(this, args); },
  'RiskPropertiesCountermeasures.Find': async function (...args) { return await RiskPropertiesCountermeasuresFind.apply(this, args); },
  'RiskProperties.GetPortfolio': async function (...args) { return await RiskPropertiesGetPortfolio.apply(this, args); },
  'RiskProperties.Filter': async function (...args) { return await RiskPropertiesFilter.apply(this, args); },
  // Exactly two arguments are forwarded, spelled out rather than `...args`: a
  // third argument from a DDP client would be where companyId and the acting
  // user get injected, and both are derived server-side from the session.
  'RiskProperties.ReconcileFromSarif': async function (moduleId, testIds) {
    return await RiskPropertiesReconcileFromSarif({moduleId, testIds});
  }
});
