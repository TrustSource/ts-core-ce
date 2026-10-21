import {Meteor} from 'meteor/meteor';
import {Random} from 'meteor/random';
import RiskProperties from '/imports/lib/collections/riskProperties';

Meteor.startup(async () => {
  /**
   * Countermeasures gained a per-entry _id so the REST API can address them
   * individually (/risks/:id/countermeasures/:cmId). Backfill: assign an _id
   * to every stored countermeasure that lacks one. The selector only matches
   * documents that still contain id-less entries, so this is a no-op on
   * every start after the first.
   */
  const risks = await RiskProperties.find(
    {'riskProperties.countermeasures': {$elemMatch: {_id: {$exists: false}}}},
    {fields: {'riskProperties.countermeasures': 1}}
  ).fetchAsync();
  for (const risk of risks) {
    const countermeasures = risk.riskProperties.countermeasures.map(function (cm) {
      return cm._id ? cm : {...cm, _id: Random.id()};
    });
    await RiskProperties.updateAsync(risk._id,
      {$set: {'riskProperties.countermeasures': countermeasures}});
  }
});
