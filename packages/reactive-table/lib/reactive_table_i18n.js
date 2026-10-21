// anti:i18n replacement - register a global Blaze helper for i18n
// The reactive-table templates use {{i18n 'reactiveTable.filter'}} etc.

var translations = {
  en: {
    reactiveTable: {
      filter: 'Filter',
      columns: 'Columns',
      show: 'Show',
      rowsPerPage: 'rows per page',
      page: 'Page',
      of: 'of'
    }
  },
  de: {
    reactiveTable: {
      filter: 'Filter',
      columns: 'Spalten',
      show: 'Zeige',
      rowsPerPage: 'Zeilen pro Seite',
      page: 'Seite',
      of: 'von'
    }
  }
};

function resolveKey(obj, key) {
  return key.split('.').reduce(function (o, k) { return o && o[k]; }, obj);
}

// Register global Blaze helper 'i18n'
if (typeof Template !== 'undefined') {
  Template.registerHelper('i18n', function (key) {
    var lang = (typeof navigator !== 'undefined' && navigator.language && navigator.language.substring(0, 2)) || 'en';
    var dict = translations[lang] || translations.en;
    return resolveKey(dict, key) || resolveKey(translations.en, key) || key;
  });
}
