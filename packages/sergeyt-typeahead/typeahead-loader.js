// sergeyt:typeahead — expose Typeahead global with compile() for Blaze templates
import { Blaze } from 'meteor/blaze';
import { Template } from 'meteor/templating';
import { HTML } from 'meteor/htmljs';

const Typeahead = {
  compile(templateName) {
    return function (context) {
      const tmpl = Template[templateName];
      if (!tmpl) return '<span>' + templateName + ' not found</span>';
      const div = document.createElement('div');
      Blaze.renderWithData(tmpl, context, div);
      return div.innerHTML;
    };
  }
};

window.Typeahead = Typeahead;
