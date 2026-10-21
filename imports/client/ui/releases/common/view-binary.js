import {Template} from 'meteor/templating';

Template.viewBinary.helpers({
  reactiveTableSettings: function () {
    return {
      collection: this.binaryLinks || [],
      rowsPerPage: 15,
      showFilter: true,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Created',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Link',
          cellClass: 'col-binary-link',
          tmpl: Template.reactiveTableBinaryLinkCell
        },
        {
          fieldId: 'comment',
          key: 'comment',
          label: 'Comment',
          fn: function (value, object) { return object.comment; }
        },
        {
          fieldId: 'userName',
          key: 'userName',
          label: 'Creator',
          cellClass: 'col-sender',
          fn: function (value, object) { return object.userName; }
        }
      ]
    };
  }
});
