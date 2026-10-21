import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import i18n from 'meteor/universe:i18n';
import Notify from '/imports/api/notify';
import {buildCryptoPayload} from '/imports/lib/cyclonedx/cryptoForm';
import * as E from '/imports/lib/cyclonedx/enums';

const FORM = '#AlgorithmsSettingsAddForm'
const MODAL = '#AlgorithmsSettingsAddModal'
const LOADING = 'loadingInProgress'
const EDIT_ITEM = 'cryptoEditItem'

// Set one field by name; multi-selects (select2) need an array value + change event.
function setFieldVal(target, name, value, isMulti) {
  const el = target.find('[name=' + name + ']');
  if (!el.length) return;
  if (isMulti) {
    let arr = [];
    if (Array.isArray(value)) arr = value;
    else if (value) arr = [value];
    el.val(arr).trigger('change');
  } else {
    el.val(value === undefined || value === null ? '' : value).trigger('change');
  }
}

// Show only the field group that belongs to the selected asset type. Scoped to the
// given modal so multiple rendered instances (module + project + company lists each
// include this modal) never toggle each other's groups.
function applyAssetGroup(target, assetType) {
  const type = assetType || 'algorithm';
  target.find('.crypto-asset-group').hide();
  target.find('.crypto-asset-group[data-asset-group="' + type + '"]').show();
}

// Blank every field (used when opening the modal in "add" mode).
function resetForm(target) {
  ['addAlgorithm', 'primitive', 'parameterSetIdentifier', 'curve', 'mode', 'padding',
    'executionEnvironment', 'implementationPlatform', 'classicalSecurityLevel',
    'nistQuantumSecurityLevel', 'comment', 'origin', 'subjectName', 'issuerName',
    'notValidBefore', 'notValidAfter', 'certificateFormat', 'certificateFileExtension',
    'serialNumber', 'version', 'materialSize', 'materialFormat', 'type', 'materialType',
    'materialState'].forEach((name) => setFieldVal(target, name, ''));
  ['cryptoFunctions', 'certificationLevel', 'certificateState'].forEach(
    (name) => setFieldVal(target, name, [], true));
  setFieldVal(target, 'assetType', 'algorithm');
  target.find('[name=used]').prop('checked', false).trigger('change');
  target.find('[name=addAlgorithm]').removeClass('error');
  applyAssetGroup(target, 'algorithm'); // show algorithm group explicitly
}

// Fill the form from a stored crypto-properties row (used in "edit" mode). All four
// per-type groups are populated; the submit handler only reads the selected type's keys.
function populateForm(target, item) {
  const assetType = item.assetType || 'algorithm';
  setFieldVal(target, 'addAlgorithm', item.name);
  setFieldVal(target, 'comment', item.comment);
  setFieldVal(target, 'origin', item.origin);
  target.find('[name=used]').prop('checked', !!item.used).trigger('change');
  setFieldVal(target, 'assetType', assetType);
  applyAssetGroup(target, assetType); // show the matching group explicitly

  const a = item.algorithmProperties || {};
  setFieldVal(target, 'primitive', a.primitive);
  setFieldVal(target, 'parameterSetIdentifier', a.parameterSetIdentifier);
  setFieldVal(target, 'curve', a.curve);
  setFieldVal(target, 'mode', a.mode);
  setFieldVal(target, 'padding', a.padding);
  setFieldVal(target, 'cryptoFunctions', a.cryptoFunctions, true);
  setFieldVal(target, 'executionEnvironment', a.executionEnvironment);
  setFieldVal(target, 'implementationPlatform', a.implementationPlatform);
  setFieldVal(target, 'certificationLevel', a.certificationLevel, true);
  setFieldVal(target, 'classicalSecurityLevel', a.classicalSecurityLevel);
  setFieldVal(target, 'nistQuantumSecurityLevel', a.nistQuantumSecurityLevel);

  const c = item.certificateProperties || {};
  setFieldVal(target, 'subjectName', c.subjectName);
  setFieldVal(target, 'issuerName', c.issuerName);
  setFieldVal(target, 'notValidBefore', c.notValidBefore);
  setFieldVal(target, 'notValidAfter', c.notValidAfter);
  setFieldVal(target, 'certificateFormat', c.certificateFormat);
  setFieldVal(target, 'certificateFileExtension', c.certificateFileExtension);
  setFieldVal(target, 'serialNumber', c.serialNumber);
  setFieldVal(target, 'certificateState', c.certificateState, true);

  const p = item.protocolProperties || {};
  setFieldVal(target, 'type', p.type);
  setFieldVal(target, 'version', p.version);

  const m = item.relatedCryptoMaterialProperties || {};
  setFieldVal(target, 'materialType', m.type);
  setFieldVal(target, 'materialState', m.state);
  setFieldVal(target, 'materialSize', m.size);
  setFieldVal(target, 'materialFormat', m.format);
}


Template.AlgorithmsSettingsAddModal.onRendered(function () {
  Meteor.callAsync('getAlgorithms').then(data => {
    if(data){
      Session.set('getAlgorithmsSettings',data);
      Meteor.setTimeout(()=>{
        $('select.select2').select2({
          placeholder: '',
          width: '100%'
        });
      }, 100)
    }
  }).catch(function(error) {
    console.error('getAlgorithms failed:', error);
  })
  $('.i-checks').iCheck({
    checkboxClass: 'icheckbox_square-green',
    radioClass: 'iradio_square-green'
  });
  const template = Template.instance();
  $(FORM).validate({
    rules: {
      addAlgorithm: {
        required: true
      },
      primitive: {
        required: false
      },
      parameterSetIdentifier: {
        required: false
      },
      curve: {
        required: false
      },
      executionEnvironment: {
        required: false
      },
      implementationPlatform: {
        required: false
      },
      certificationLevel: {
        required: false
      },
      mode: {
        required: false
      },
      padding: {
        required: false
      },
      cryptoFunctions: {
        required: false
      },
      classicalSecurityLevel: {
        required: false
      },
      nistQuantumSecurityLevel: {
        required: false
      },
      origin: {
        required: false
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      Session.set(LOADING, true)
      const addAlgorithm = $(form).find('[name=addAlgorithm]').val();
      if (!addAlgorithm) {
        Notify.warn(i18n.__('CryptoAlgorithmRequired'));
      } else {
        const assetType = $(form).find('[name=assetType]').val() || 'algorithm';
        const comment = $(form).find('[name=comment]').val();
        const used = $(form).find('[name=used]').is(':checked');
        const origin = $(form).find('[name=origin]').val();

        // Collect raw values keyed by spec field name (map collision-avoidance names back).
        const values = {
          // algorithm
          primitive: $(form).find('[name=primitive]').val(),
          parameterSetIdentifier: $(form).find('[name=parameterSetIdentifier]').val(),
          curve: $(form).find('[name=curve]').val(),
          mode: $(form).find('[name=mode]').val(),
          padding: $(form).find('[name=padding]').val(),
          cryptoFunctions: $(form).find('[name=cryptoFunctions]').val(),
          executionEnvironment: $(form).find('[name=executionEnvironment]').val(),
          implementationPlatform: $(form).find('[name=implementationPlatform]').val(),
          certificationLevel: $(form).find('[name=certificationLevel]').val(),
          classicalSecurityLevel: $(form).find('[name=classicalSecurityLevel]').val(),
          nistQuantumSecurityLevel: $(form).find('[name=nistQuantumSecurityLevel]').val(),
          // certificate
          subjectName: $(form).find('[name=subjectName]').val(),
          issuerName: $(form).find('[name=issuerName]').val(),
          notValidBefore: $(form).find('[name=notValidBefore]').val(),
          notValidAfter: $(form).find('[name=notValidAfter]').val(),
          certificateFormat: $(form).find('[name=certificateFormat]').val(),
          certificateFileExtension: $(form).find('[name=certificateFileExtension]').val(),
          serialNumber: $(form).find('[name=serialNumber]').val(),
          certificateState: $(form).find('[name=certificateState]').val(),
          // protocol (proto_type/version use bare names type/version)
          type: $(form).find('[name=type]').val(),
          version: $(form).find('[name=version]').val(),
          // related-crypto-material (mapped from collision-avoidance names)
          state: $(form).find('[name=materialState]').val(),
          size: $(form).find('[name=materialSize]').val(),
          format: $(form).find('[name=materialFormat]').val()
        };
        if (assetType === 'related-crypto-material') {
          values.type = $(form).find('[name=materialType]').val();
        }

        const cryptoPayload = buildCryptoPayload(assetType, values);
        const self = template.data;
        const editItem = Session.get(EDIT_ITEM);
        let allData = Session.get('getAlgorithmSettingsList') || [];

        if (editItem && editItem._id) {
          // EDIT: replace name/meta + all four *Properties objects, blanking the ones
          // that don't belong to the (possibly changed) asset type, then patch the
          // cached list row so the table updates without a re-fetch.
          const props = Object.assign({
            algorithmProperties: {},
            certificateProperties: {},
            protocolProperties: {},
            relatedCryptoMaterialProperties: {}
          }, cryptoPayload);
          const $set = Object.assign({name: addAlgorithm, comment, used, origin}, props);
          Meteor.callAsync('CryptoProperties.Update', {$set}, editItem._id).then(() => {
            const updated = allData.map((row) =>
              row._id === editItem._id ? Object.assign({}, row, $set) : row);
            Session.set('getAlgorithmSettingsList', updated);
            Notify.success(i18n.__('CryptoAlgorithmUpdated'));
            Session.set(LOADING);
            $(MODAL).modal('hide');
          }).catch(function (error) {
            Notify.danger(error.reason || error.message || i18n.__('CryptoUpdateError'));
            Session.set(LOADING);
          });
          return;
        }

        const item = Object.assign({
          created: new Date(),
          name: addAlgorithm,
          comment,
          used,
          origin
        }, cryptoPayload)
        if (self.id === 'moduleCmpAlgorithmsSettings') {
          item.moduleId = self.docId;
        } else if (self.id === 'projCmpAlgorithmsSettings') {
          item.projectId = self.docId;
        }
        allData.push(item)
        Meteor.callAsync('CryptoProperties.Create', item).then(data => {
          if(data){
            item._id = data
            Session.set('getAlgorithmSettingsList', allData);
            Notify.success(i18n.__('CryptoAlgorithmAdded'));
          }
          Session.set(LOADING)
          $(MODAL).modal('hide');
        }).catch(function(error) {
          Notify.danger(error.reason || error.message || i18n.__('CryptoCreateError'));
          Session.set(LOADING);
        });
      }
    }
  });

  $(MODAL).off('.AlgorithmsSettingsAddModal')
    .on('show.bs.modal.AlgorithmsSettingsAddModal', function (event) {
      $(FORM).validate().resetForm();
      const target = $(event.target);
      // select2 fires its change via jQuery .trigger('change'), which Blaze's native
      // event delegation does not catch - bind directly on the select so switching the
      // asset type reliably toggles the field group below. Scoped to this modal instance.
      target.find('[name=assetType]').off('change.assetGroup')
        .on('change.assetGroup', function () {
          applyAssetGroup(target, $(this).val());
        });
      const editItem = Session.get(EDIT_ITEM);
      if (editItem) {
        populateForm(target, editItem);
      } else {
        resetForm(target);
      }
      $('.i-checks').iCheck('update');
    })
    .on('hidden.bs.modal.AlgorithmsSettingsAddModal', function () {
      Session.set(EDIT_ITEM, null);   // leave edit mode when the modal closes
    });
});

Template.AlgorithmsSettingsAddModal.onDestroyed(function () {
  $(MODAL).off('.AlgorithmsSettingsAddModal');
  Session.set(EDIT_ITEM, null);
});

Template.AlgorithmsSettingsAddModal.events({
  'submit #AlgorithmsSettingsAddForm': function (event) {
    event.preventDefault();
  },
  'change [name=assetType]': function (event) {
    const select = $(event.currentTarget);
    const modal = select.closest('.modal');
    applyAssetGroup(modal.length ? modal : $(MODAL), select.val());
  }
});

Template.AlgorithmsSettingsAddModal.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  isEditMode: function () {
    return !!Session.get(EDIT_ITEM);
  },
  getAlgorithms: function () {
    let list = Session.get('getAlgorithmsSettings');
    if(list){
      list.unshift({Algorithm:''})
      return list
    }else{
      return []
    }
  },
  assetTypeValues: function () {
    return E.ASSET_TYPES;
  },
  primitiveValues: function () {
    return [''].concat(E.PRIMITIVE);
  },
  executionEnvironmentValues: function () {
    return [''].concat(E.EXECUTION_ENVIRONMENT);
  },
  implementationPlatformValues: function () {
    return [''].concat(E.IMPLEMENTATION_PLATFORM);
  },
  certificationLevelValues: function () {
    return E.CERTIFICATION_LEVEL;
  },
  modeValues: function () {
    return [''].concat(E.MODE);   // fixed: real cipher modes
  },
  paddingValues: function () {
    return [''].concat(E.PADDING);
  },
  cryptoFunctionsValues: function () {
    return E.CRYPTO_FUNCTIONS;
  },
  certificateStateValues: function () {
    return E.CERTIFICATE_STATE;
  },
  protocolTypeValues: function () {
    return [''].concat(E.PROTOCOL_TYPE);
  },
  relatedMaterialTypeValues: function () {
    return [''].concat(E.RELATED_MATERIAL_TYPE);
  },
  relatedMaterialStateValues: function () {
    return [''].concat(E.RELATED_MATERIAL_STATE);
  }
});
