import {Template} from 'meteor/templating';
import _ from 'underscore';


function getConfidenceScore(score) {
  if (score) {
    if (+score === 5) {
      return 1
    } else if (+score === 4) {
      return 2
    } else if (+score === 2) {
      return 4
    } else if (+score === 1) {
      return 5
    } else {
      return score
    }
  }
  return 'UNKNOWN';
}

Template.cvesBumpHints.helpers({
  mappedHints: function () {
    let vulns = _.groupBy(this.vulns, function(vuln){
      return +vuln.getConfidence()
    })
    let scores = _.filter(Object.keys(vulns),(score)=>{
      const changedScore = +getConfidenceScore(score)
      return (changedScore >= +this.confidence) && vulns[score][0].ecs.bump_hints
    }).sort()
    if(vulns[scores[0]] && vulns[scores[0]][0].ecs && vulns[scores[0]][0].ecs.bump_hints){
      return _.filter(_.map(scores,(score)=>{
        if(vulns[score] && vulns[score][0] && vulns[score][0].ecs){
          let {bump_hints, confidence, product, vendor, platform} = vulns[score][0].ecs
          confidence = getConfidenceScore(confidence)
          return {bump_hints, confidence, product, vendor, platform}
        }
        return null
      }),(score)=>{
        return score && score.bump_hints
      })
    }
    return null
  },
  getConfidenceScore: function () {
    return this.confidence;
  },
  getConfidenceLevel: function () {
    const score = this.confidence;
    if (score) {
      if (score === 5 || score === 4 || score === 3) {
        return 'LOW'
      } else if (score === 2) {
        return 'MID'
      } else if (score === 1) {
        return 'HIGH'
      }
    }
    return 'UNKNOWN';
  },
  getConfidenceClass: function () {
    const score = this.confidence;
    if (score) {
      if (score === 1 || score === 'HIGH') {
        return '5'
      } else if (score === 2) {
        return '4'
      } else if (score === 3) {
        return '3'
      } else if (score === 5 || score === 'LOWEST') {
        return '1'
      }
    }
    return '2';
  },
  getConfidenceProduct: function () {
    return this.product;
  },
  getConfidenceVendor: function () {
    return this.vendor;
  },
  getConfidencePlatform: function () {
    return this.platform;
  }
});
