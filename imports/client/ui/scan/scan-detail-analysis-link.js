import {Template} from 'meteor/templating';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';

Template.scanDetailAnalysisLink.helpers({
  actionRoute: function () {
    let analysis = ReactiveMethod.call('getLastScanAnalysis', this.scanId);
    let module = ReactiveMethod.call('getLastScanModule', this.moduleId);
    if(analysis && module){
      return {
        route: 'moduleDependencies',
        params: {
          moduleId: this.moduleId,
          projectId: module.projectId || Projects.UNASSIGNED
        },
        query: {
          analysis: analysis._id
        }
      };
    }
    return false
  }
});
