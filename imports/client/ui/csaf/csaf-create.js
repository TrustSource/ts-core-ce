/* global document:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import {setNestedValue, getNestedValue, addToArray, removeFromArray} from '/imports/lib/json';
import Notify from '/imports/api/notify';
import VEX from '/imports/lib/converter/vex';
import {Config} from '/imports/config';
import Utils from '/imports/lib/utils';
import Products from '../../../lib/collections/products';

const IN_PROGRESS = 'requestInProgress'
const TREE_BRANCHES = 'product_tree.branches'
const TOTAL_STEPS = 5;

// ---------------------------------------------------------------------------
// product_id token map
//
// The secret that obfuscates a module _id into a CSAF product_id lives on the
// server now, so this page can no longer decrypt a stored product_id back to an
// id. It keeps a {token: id} map instead, filled by ONE CSAF.DecodeProductIds
// call when a saved document is opened and by the CSAF.EncodeModuleIds result
// when a box is ticked.
//
// Module-scoped rather than template-instance state, and a ReactiveVar rather
// than a plain object, because two of the readers are Blaze HELPERS: they are
// synchronous and cannot await the decode, and one of them
// (affeactedProductListItem) lives in a different template that sees only its
// own data context. The reactivity is what ticks the boxes when the decode
// lands, with no interaction and no page reload.
//
// The map is PROTOTYPE-FREE, and so is every object built from it. A product_id
// is read out of an uploaded document, so a token can legitimately be the string
// '__proto__'; on a plain {} that key sets the prototype instead of creating an
// entry, the write is a silent no-op and every hasOwnProperty check after it
// answers false. Reads go through lookupModuleId for the mirror image of the
// same problem: a missing key would otherwise resolve off Object.prototype.
// ---------------------------------------------------------------------------
const productIdMap = new ReactiveVar(Object.create(null));
// The document the map was built for, so the bulk decode runs exactly once per
// opened document however often the route data churns. `false` is the "nothing
// loaded yet" sentinel: a document id normalises to a string and can never
// collide with it, while a brand new document normalises to an empty one.
let _decodedDocumentId = false;

function productIdOf(branch) {
  return branch && branch.product && branch.product.product_id;
}

function lookupModuleId(map, token) {
  return (typeof token === 'string' && Object.prototype.hasOwnProperty.call(map, token))
    ? map[token]
    : undefined;
}

function moduleIdFromProductId(token) {
  return lookupModuleId(productIdMap.get(), token);
}

function getProjectBranches(data) {
  const branches = data && getNestedValue(data, TREE_BRANCHES);
  return branches && branches[0] && branches[0].branches;
}

function ensureProjectBranches(data) {
  if(!data.product_tree){
    data.product_tree = {}
  }
  if(!data.product_tree.branches){
    data.product_tree.branches = []
  }
  if(!data.product_tree.branches[0]){
    const company = Session.get('company')
    data.product_tree.branches.push({
      'category': 'vendor',
      'name': company && company.name,
      'branches': []
    })
  }
  return data.product_tree.branches[0].branches;
}

// The one answer to "is this module or product already in the document?", shared
// by both isChecked helpers so the Modules tab and the Products tab cannot
// drift. The ReactiveVar is read unconditionally: a short circuit ahead of it
// would register no Blaze dependency and leave the box stale until a reload.
function isModuleChecked(data, projectName, moduleId) {
  const map = productIdMap.get();
  const projects = getProjectBranches(data);
  const project = projects && projects.find(item =>{
    return item.name === projectName
  })
  return !!(project && project.branches.find(item =>{
    return lookupModuleId(map, productIdOf(item)) === moduleId
  }))
}

function rememberProductId(token, id) {
  const map = productIdMap.get();
  const next = Object.create(null);
  Object.keys(map).forEach(function (key) {
    next[key] = map[key];
  });
  next[token] = id;
  productIdMap.set(next);
}

function resetProductIdMap() {
  _decodedDocumentId = false;
  productIdMap.set(Object.create(null));
}

function csafErrorText(error) {
  return (error && (error.reason || error.message)) || error;
}

// Every DISTINCT product_id in the document, so opening it costs one call rather
// than one per checkbox.
function collectProductIds(data) {
  const tokens = [];
  const seen = new Set();
  const walk = function (branches) {
    if(!Array.isArray(branches)){
      return;
    }
    branches.forEach(function (branch) {
      const token = productIdOf(branch);
      if(typeof token === 'string' && token && !seen.has(token)){
        seen.add(token);
        tokens.push(token);
      }
      walk(branch && branch.branches);
    });
  };
  walk(data && getNestedValue(data, TREE_BRANCHES));
  return tokens;
}

function loadProductIdMap(documentId, data) {
  const key = documentId || '';
  if(_decodedDocumentId === key){
    return;
  }
  _decodedDocumentId = key;
  productIdMap.set(Object.create(null));
  const tokens = collectProductIds(data);
  if(!tokens.length){
    return;
  }
  Meteor.callAsync('CSAF.DecodeProductIds', tokens).then(function (decoded) {
    if(_decodedDocumentId !== key){
      return;
    }
    const map = Object.create(null);
    Object.keys(decoded || {}).forEach(function (token) {
      if(decoded[token]){
        map[token] = decoded[token];
      }
    });
    productIdMap.set(map);
  }).catch(function (error) {
    if(_decodedDocumentId !== key){
      return;
    }
    // Every checkbox stays unticked, which reads exactly like the document
    // having lost its products. Say what happened instead - and never write the
    // unresolved state back: the stored product_id values stay byte-identical.
    Notify.danger('Could not read the products of this document: ' + csafErrorText(error));
  });
}

// The token for a newly ticked module or product. Fails CLOSED: with no token
// there is no branch to add, so the tick goes back too. A ticked box backed by
// no branch is a product the user believes is in the advisory and is not.
function encodeSelectedId(checkbox, id) {
  return Meteor.callAsync('CSAF.EncodeModuleIds', [id]).then(function (encoded) {
    // Own-key read, the same rule the map itself follows: a module _id is
    // client-chosen within a tenant, and a plain read of encoded['__proto__']
    // on a reply that does not carry that key answers with Object.prototype,
    // which is truthy and would sail past the refusal check below.
    const token = encoded ? lookupModuleId(encoded, id) : undefined;
    if(!token){
      throw new Error('the server returned no product id');
    }
    rememberProductId(token, id);
    return token;
  }).catch(function (error) {
    if(checkbox){
      checkbox.checked = false;
    }
    Notify.danger('Could not add this product to the document: ' + csafErrorText(error));
    return null;
  });
}

Template.csafCreate.onCreated(function () {
  // No token from a previously opened document may survive into this one.
  resetProductIdMap();
  const today = new Date();
  const id = 'New document';
  this.jsonData = new ReactiveVar({
    document: {
      category: 'csaf_vex',
      csaf_version: '2.0',
      lang: 'en',
      distribution: {
        tlp: {
          label: 'WHITE',
          url: 'https://www.first.org/tlp/'
        }
      },
      notes: [
        {
          category: 'summary',
          text: 'Detailed list of project vulnerabilities',
          title: 'Author comment'
        }
      ],
      // The user's company publishes the advisory from this installation.
      publisher: {
        category: 'vendor',
        name: (Session.get('company') && Session.get('company').name) || Config.name,
        namespace: Config.appUrl
      },
      title: 'Project CSAF document',
      tracking: {
        current_release_date: `${today.toISOString()}`,
        generator: {
          date: `${today.toISOString()}`,
          engine: {
            name: Config.name,
            version: Config.version
          }
        },
        id,
        initial_release_date: `${today.toISOString()}`,
        revision_history: [
          {
            'date': `${today.toISOString()}`,
            'number': '1',
            'summary': 'Initial version.'
          }
        ],
        status: 'final',
        version: '1'
      }
    }
  });
  this.currentStep = new ReactiveVar(1);
  this.csafCategory = new ReactiveVar();
  this.csafVulnerabilities = new ReactiveVar();
  this.selectedCve = new ReactiveVar();
  this.currentProductStatus = new ReactiveVar('under_investigation');
  Session.set('affectedCurrentTab', 'affectedProducts')
  Session.set('selectedTreeVisibility', 'all')
});


Template.csafCreate.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  const instance = this;
  this.autorun(function () {
    const data = Template.currentData();
    let stored;
    if(data && data._id){
      stored = data.data && JSON.parse(data.data);
      instance.jsonData.set(stored);
    }
    // One bulk decode per opened document, and a hard reset whenever the route
    // swings to a different document or to a brand new one: a token belonging to
    // the document just left must never tick a box in the one now open.
    loadProductIdMap(data && data._id, stored);
    let query = Router.current().params.query;
    if(query && query.step){
      instance.currentStep.set(query.step);
    }
  });
});

Template.csafCreate.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
  resetProductIdMap();
});

Template.csafCreate.events({
  'change .step_1 input, change .step_1 select': function (event, instance) {
    const path = event.currentTarget.getAttribute('data-path');
    const value = (event.currentTarget.type === 'checkbox')
      ? event.currentTarget.checked
      : event.currentTarget.value;
    if(path){
      const data = instance.jsonData.get();
      setNestedValue(data, path, value);
      instance.jsonData.set(data);
    }
  },
  'change .affected_products': async function (event, instance) {
    const checked = event.currentTarget.checked
    const value = event.currentTarget.value
    if(value){
      const company = Session.get('company')
      let productId = value.split('_m_')[1];
      let productData = Products.findOne(productId);
      let parentId = value.split('_m_')[0];
      let parentData = Products.findOne(parentId) || {
        name: company.name,
        _id: 'root'
      };
      const data = instance.jsonData.get();
      // List of available categories
      // "architecture",
      // "host_name",
      // "language",
      // "legacy",
      // "patch_level",
      // "product_family", - family
      // "product_name", - project - variant
      // "product_version", - module - version
      // "product_version_range", - version
      // "service_pack",
      // "specification",
      // "vendor"
      // ts-app software parts:
      // project module
      // ts-app hardware parts:
      // class family variant version position
      if(checked){
        // The token is minted server-side now, so it has to be in hand BEFORE
        // the tree is touched: a refused mint must leave the document exactly as
        // it was, rather than a half-built branch sitting behind an unticked box.
        const token = await encodeSelectedId(event.currentTarget, productData._id);
        if(!token){
          return;
        }
        const projects = ensureProjectBranches(data);
        let project = projects.find(item =>{
          return item.name === parentData.name
        })
        if(!project){
          project = {
            'category': 'product_name',
            'name': parentData.name,
            'branches': []
          }
          projects.push(project)
        }
        let module = project.branches.find(item =>{
          return moduleIdFromProductId(productIdOf(item)) === productData._id
        })
        if(!module){
          module = await VEX.moduleToProductVersion(productData, token)
          project.branches.push(module)
        }
      }else{
        const projects = getProjectBranches(data);
        let project = projects && projects.find(item =>{
          return item.name === parentData.name
        })
        let moduleIndex = project ? project.branches.findIndex(item =>{
          return moduleIdFromProductId(productIdOf(item)) === productData._id
        }) : -1;
        // A map miss is a normal state now (a token that would not decode, or a
        // click landing before the bulk decode did) and splice(-1, 1) removes the
        // LAST branch rather than none.
        if(moduleIndex === -1){
          return;
        }
        project.branches.splice(moduleIndex, 1);
        if(!project.branches.length){
          projects.splice(projects.indexOf(project), 1);
        }
      }
      instance.jsonData.set(data);
    }
  },
  'change .affected_modules': async function (event, instance) {
    const checked = event.currentTarget.checked
    const value = event.currentTarget.value
    if(value){
      let moduleId = value.split('_m_')[1];
      let modules = Session.get('modulesByProject');
      let moduleData = modules.find(item => item._id === moduleId);
      let projectId = value.split('_m_')[0];
      let projectData = Projects.findOne(projectId);
      const data = instance.jsonData.get();
      if(checked){
        // Mint first, mutate second - see the Products handler above.
        const token = await encodeSelectedId(event.currentTarget, moduleData._id);
        if(!token){
          return;
        }
        const projects = ensureProjectBranches(data);
        let project = projects.find(item =>{
          return item.name === projectData.name
        })
        if(!project){
          project = {
            'category': 'product_name',
            'name': projectData.name,
            'branches': []
          }
          projects.push(project)
        }
        let module = project.branches.find(item =>{
          return moduleIdFromProductId(productIdOf(item)) === moduleData._id
        })
        if(!module){
          module = await VEX.moduleToProductVersion(moduleData, token)
          project.branches.push(module)
        }
      }else{
        const projects = getProjectBranches(data);
        let project = projects && projects.find(item =>{
          return item.name === projectData.name
        })
        let moduleIndex = project ? project.branches.findIndex(item =>{
          return moduleIdFromProductId(productIdOf(item)) === moduleData._id
        }) : -1;
        // A map miss removes nothing: splice(-1, 1) would take out the LAST
        // branch instead.
        if(moduleIndex === -1){
          return;
        }
        project.branches.splice(moduleIndex, 1);
        if(!project.branches.length){
          projects.splice(projects.indexOf(project), 1);
        }
      }
      instance.jsonData.set(data);
    }
  },
  'click .add_item:not([disabled])': function (event, instance) {
    const dataRoot = instance.jsonData.get();
    const path = event.currentTarget.getAttribute('data-path');
    const defaultItem = event.currentTarget.getAttribute('data-default-item');
    const now = new Date();
    const parent = getNestedValue(dataRoot, path);
    const items = {
      acknowledgments: {
        summary: 'New item'
      },
      acknowledgmentsNames: '',
      acknowledgmentsUrls: '',
      notes: {
        category: 'general',
        text: 'New note'
      },
      references: {
        category: 'external',
        summary: 'New reference'
      },
      aliases: '',
      remediations:{
        category: 'workaround',
        details: 'New remediation'
      },
      revision_history: {
        date: now.toISOString(),
        number: (parent && parent.length || 0) + 1,
        summary: 'Init revision'
      }
    }
    addToArray(dataRoot, path, items[defaultItem]);
    instance.jsonData.set(dataRoot);
  },
  'click .remove_item:not([disabled])': function (event, instance) {
    const dataRoot = instance.jsonData.get();
    const path = event.currentTarget.getAttribute('data-path');
    const index = parseInt(event.currentTarget.getAttribute('data-index'), 10);
    const data = instance.jsonData.get();
    removeFromArray(dataRoot, path, index);
    instance.jsonData.set(data);
  },
  'click .collapse-action': function (event) {
    const action = $(event.target).closest('.collapse-action');
    $(action).next('.panel-body').toggleClass('hidden');
  },
  'click .next_step:not([disabled])': function (event) {
    event.preventDefault();
    const currentStep = Template.instance().currentStep.get();
    if(currentStep < TOTAL_STEPS){
      const nextStep = +currentStep + 1;
      Template.instance().currentStep.set(nextStep);
    }
  },
  'click .select_type:not([disabled])': function (event, instance) {
    event.preventDefault();
    const currentStep = Template.instance().currentStep.get();
    const type = event.currentTarget.getAttribute('data-type');
    Template.instance().csafCategory.set(type);
    if(currentStep < TOTAL_STEPS){
      const nextStep = +currentStep + 1;
      const dataRoot = instance.jsonData.get();
      setNestedValue(dataRoot, 'document.category', type);
      Template.instance().currentStep.set(nextStep);
    }
  },
  'click .prev_step:not([disabled])': function (event) {
    event.preventDefault();
    const currentStep = Template.instance().currentStep.get();
    if(currentStep > 1){
      const nextStep = +currentStep - 1;
      Template.instance().currentStep.set(nextStep);
      Template.instance().selectedCve.set();
    }
  },
  'click .save_changes:not([disabled])': function (event) {
    event.preventDefault();
    $('#csafCreateForm').submit();
  },
  'submit #csafCreateForm': function (event, instance) {
    event.preventDefault();
    const self = this;
    const newData = JSON.stringify(instance.jsonData.get());
    Session.set(IN_PROGRESS, true);
    Meteor.callAsync('CSAF.Validate', {file: newData}).then(function() {
      Meteor.callAsync('CSAF.CreateOrUpdate', {$set: {data: newData}}, self._id).then(function(data) {
        if(!self._id && data){
          let query = Router.current().params.query || {};
          query.csafId = data;
          query.step = instance.currentStep.get()
          Router.go(Router.current().route.getName(), {}, {
            query: query
          });
          Notify.success('CSAF has been created');
        }else{
          let query = Router.current().params.query || {};
          query.step = instance.currentStep.get()
          Router.go(Router.current().route.getName(), {}, {
            query: query
          });
          Notify.success('CSAF ' + self.name + ' has been updated');
        }
      }).catch(function(error) {
        Notify.danger(error.message);
      }).finally(function() {
        Session.set(IN_PROGRESS);
      })
    }).catch(function(error) {
      Notify.danger(error.message);
      Session.set(IN_PROGRESS);
    })
  },
  'keydown [name=searchVulnerability]': function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      findVulnerability()
    }
  },
  'click .find_vulnerability:not([disabled])': function (event) {
    event.preventDefault();
    findVulnerability()
  },
  'click .add_cve:not([disabled])': async function (event, instance) {
    event.preventDefault();
    const dataRoot = instance.jsonData.get();
    const vulnerability = this;
    const productIds = [];
    const branches = getNestedValue(dataRoot, TREE_BRANCHES);
    const projects = branches && branches[0] && branches[0].branches;
    projects && projects.forEach(item =>{
      item.branches.forEach(item =>{
        productIds.push(item.product.product_id)
      })
    })
    const cweMap = {};
    if (vulnerability.weakness) {
      await new Promise((resolve) => {
        // Company argument omitted, not null: requireCompanyMember reads
        // `undefined` as "derive from the caller" and 400s on an explicit null.
        Meteor.call('tsVulnerabilityCweDetails', vulnerability.weakness, (err, res) => {
          if (!err && res && res.data && res.data[1] && res.data[1].name) {
            cweMap[vulnerability.weakness] = res.data[1].name;
          }
          resolve();
        });
      });
    }
    const convertedObj = VEX.vulnerabilityToCVE({key: vulnerability.cve_id}, {}, vulnerability, {}, productIds, cweMap)
    addToArray(dataRoot, 'vulnerabilities', convertedObj);
    instance.jsonData.set(dataRoot);
    instance.csafVulnerabilities.set();
    $('[name=searchVulnerability]').val('');
  },
  'click .select_cve:not([disabled])': function (event, instance) {
    event.preventDefault();
    const cve = event.currentTarget.getAttribute('data-cve');
    instance.selectedCve.set(cve);
  },
  'change #product_status:not([disabled])': function (event, instance) {
    event.preventDefault();
    const value = event.currentTarget.value;
    instance.currentProductStatus.set(value);
  },
  'change .product_status_branch:not([disabled])': function (event, instance) {
    const value = event.currentTarget.value
    const status = event.currentTarget.checked
    const data = instance.jsonData.get()
    const cveIndex = instance.selectedCve.get()
    const currentProductStatus = instance.currentProductStatus.get();
    const path = `vulnerabilities.${cveIndex}.product_status.${currentProductStatus}`
    if(status){
      addToArray(data, path, value);
    }else{
      const currentData = getNestedValue(data, path)
      const index = currentData.indexOf(value);
      removeFromArray(data, path, index);
    }
    instance.jsonData.set(data);
  },
  'click .set-active-view': function (event) {
    const view = $(event.target).attr('data-view') || $(event.target).parent().attr('data-view');
    Session.set('affectedCurrentTab', view);
  }
});

function findVulnerability() {
  const q = $('[name=searchVulnerability]').val().trim();
  const instance = Template.instance();
  instance.csafVulnerabilities.set();
  if(q){
    Session.set(IN_PROGRESS, true);
    Meteor.callAsync('tsVulnerabilityCveDetails', {cves: [q]}).then(function(data) {
      let resp = parseCveDetails(data)
      instance.csafVulnerabilities.set(resp);
    }).catch(function(error) {
      const msg = (error.reason || 'Service is not available');
      Notify.danger('Vulnerability lake error: '+ msg);
    }).finally(function() {
      Session.set(IN_PROGRESS);
    })
  }
}

function parseCveDetails(response) {
  if (response && response.data && response.data.cves && response.data.cves.length) {
    let results = response.data.cves[0]
    results.impact = Utils.groupedImpactVersions(results.impact)
    return {
      matches: response.data.matches,
      list: results
    }
  } else {
    return {
      matches: 0,
      list: {}
    }
  }
}

Template.csafCreate.helpers({
  activeTab: function (tab) {
    const currentTab = Session.get('affectedCurrentTab');
    return currentTab === tab ? 'active-tab active' : '';
  },
  activeView: function (tab) {
    const currentTab = Session.get('affectedCurrentTab');
    return currentTab === tab
  },
  getValue: function (path) {
    const data = Template.instance().jsonData.get();
    return getNestedValue(data, path);
  },
  hasData: function () {
    const data = Template.instance().jsonData.get();
    return data && data.document;
  },
  getRoot: function () {
    let parent = Template.parentData()
    if (parent.cve) {
      parent = Template.parentData(2)
    }
    return parent
  },
  isEditDisabled: function () {
    const currentStep = Template.instance().currentStep.get();
    return currentStep < 2 || Session.get(IN_PROGRESS)
  },
  isPublished: function () {
    const template = Template.instance();
    return template.data && template.data.published
  },
  isLoading: function () {
    return Session.get(IN_PROGRESS);
  },
  isSelected: function (item, value) {
    return item === value;
  },
  projectList: function () {
    return Projects.findMapped();
  },
  branchesList: function () {
    const data = Template.instance().jsonData.get();
    return getNestedValue(data, 'product_tree.branches.0.branches');
  },
  isCurrentStep: function (step) {
    const currentStep = Template.instance().currentStep.get();
    return currentStep == step
  },
  isNextAllowed: function () {
    const currentStep = Template.instance().currentStep.get();
    return currentStep < TOTAL_STEPS ? false : 'disabled';
  },
  isPrevAllowed: function () {
    const currentStep = Template.instance().currentStep.get();
    return currentStep > 1 ? false : 'disabled';
  },
  csafCategory: function () {
    return Template.instance().csafCategory.get();
  },
  currentProductStatus: function () {
    return Template.instance().currentProductStatus.get();
  },
  cveDetails: function () {
    let results = Template.instance().csafVulnerabilities.get();
    return results && results.list || {}
  },
  noMatches: function () {
    const data = Template.instance().csafVulnerabilities.get()
    return data && data.matches === 0;
  },
  isChecked: function (projectName, moduleId) {
    // Synchronous, as every Blaze helper is, so it cannot decode a stored
    // product_id: it answers from the token map, and reruns when the bulk decode
    // lands.
    const data = Template.instance().jsonData.get();
    return isModuleChecked(data, projectName, moduleId);
  },
  isCheckedBranch: function (moduleId) {
    const instance = Template.instance()
    const data = instance.jsonData.get()
    const cveIndex = instance.selectedCve.get()
    const vulnerability = getNestedValue(data, `vulnerabilities.${cveIndex}`)
    const currentProductStatus = instance.currentProductStatus.get();
    const statuses = vulnerability.product_status[currentProductStatus]
    return statuses && statuses.indexOf(moduleId) !== -1
  },
  getActiveCve: function () {
    return Template.instance().selectedCve.get()
  },
  getActiveCveClass: function (cve) {
    return Template.instance().selectedCve.get() == cve ? 'fa-circle' : 'fa-circle-thin'
  },
  getActiveCveListClass: function (cve) {
    return Template.instance().selectedCve.get() == cve ? 'active' : '';
  },
  getCurrentCve: function () {
    const instance = Template.instance();
    const data = instance.jsonData.get();
    const cveIndex = instance.selectedCve.get()
    return getNestedValue(data, `vulnerabilities.${cveIndex}`);
  },
  getCWEUrl: function (weaknessKey) {
    const key = weaknessKey && weaknessKey.substring(weaknessKey.indexOf('-') + 1)
    return Router.url('vlCweByName', null,{query:{filter:  JSON.stringify({cwe: key})}})
  },
  getCVEScore: function () {
    let baseScores = {}
    this.scores.forEach((score)=>{
      if(score.cvss_v4 && score.cvss_v4.baseScore){
        baseScores.v4 = score.cvss_v4.baseScore
      }else if(score.cvss_v3 && score.cvss_v3.baseScore){
        baseScores.v3 = score.cvss_v3.baseScore
      }else if(score.cvss_v2 && score.cvss_v2.baseScore){
        baseScores.v2 = score.cvss_v2.baseScore
      }
    })
    return baseScores.v4 || baseScores.v3 || baseScores.v2
  },
  getCVSSColor: function (score) {
    if (score) {
      if (score > 9 || score === 'critical') {
        return 'red'
      } else if (score > 7 || score === 'high') {
        return 'orange'
      } else if (score > 4 || score === 'moderate') {
        return 'yellow'
      } else if (score > 0 || score === 'low') {
        return 'green-yellow'
      }
    }
    return 'grey'
  },
  productList: function () {
    let filter = {
      parentId: { $in: [null] },
      retired: { $in: [null] }
    }
    return Products.find(filter);
  },
  currentStep: function () {
    const instance = Template.instance();
    return  instance.currentStep.get();
  },
  jsonData: function () {
    const instance = Template.instance();
    return  instance.jsonData.get();
  }
});


Template.affeactedProductListItem.helpers({
  isEditDisabled: function () {
    const currentStep = Template.instance().data.currentStep;
    return currentStep < 2 || Session.get(IN_PROGRESS)
  },
  isChecked: function (projectName, moduleId) {
    // Same answer as the wizard's own helper, from the same map: this template
    // sees only its data context, which is why the map is module-scoped.
    const data = Template.instance().data.jsonData;
    if(data){
      return isModuleChecked(data, projectName, moduleId);
    }
  },
  currentStep: function () {
    const instance = Template.instance();
    return  instance.data.currentStep;
  },
  jsonData: function () {
    const instance = Template.instance();
    return  instance.data.jsonData;
  },
  getParentId: function () {
    let data = Template.parentData(2);
    return data._id || 'root'
  },
  getParentName: function () {
    const company = Session.get('company')
    let data = Template.parentData(2);
    return (!data.providerId && data.name) || company.name
  },
  getChildrenProducts: function () {
    let filter = {
      parentId: this.identifier,
      retired: { $in: [null] }
    }
    return Products.find(filter);
  }
});
