import {Template} from 'meteor/templating';
import {pathLocation} from '/imports/lib/analysis/pathLocation';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {idParam} from '/imports/lib/mongoId';
import {Spacebars} from 'meteor/spacebars';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {moment} from 'meteor/momentjs:moment';
import {Config} from '/imports/config';
import Utils from '/imports/lib/utils';
import { i18n } from 'meteor/universe:i18n';
import {requestCount} from '/imports/lib/companies/publicKeyRequests';

// HTML-escape a value for safe interpolation into markup built by helpers that
// must return raw HTML (rendered via {{{ }}}). Escapes both text and attribute
// contexts. Use this around any user/externally-sourced value (component keys,
// file paths, labels, titles) before splicing it into a template string.
export function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

Template.registerHelper('app', function (option) {
  return Config[option];
});

// Link from a weakness id to its entry in the Vulnerability Lake. The route
// filters on the bare number, so "CWE-79", "cwe-79" and "79" all have to arrive
// as `{"cwe":"79"}` - the lake's own search accepts the prefixed spellings, but
// the links we generate should not rely on it normalising them back.
export function cweLakeUrl(cwe) {
  const match = /^\s*(?:cwe[-_:\s]?)?(\d+)\s*$/i.exec(
    cwe === null || cwe === undefined ? '' : String(cwe));
  return match ?
    Router.url('vlCweByName', null, {query: {filter: JSON.stringify({cwe: match[1]})}}) :
    undefined;
}

Template.registerHelper('cweLakeUrl', cweLakeUrl);

// A dependency path rendered as chevron-separated segments. Returns RAW HTML,
// so it is escaped first: paths come from scans and could carry
// markup. Lives here rather than in the dependency aside because the license-resolution
// confirmation dialog has to show the very same path strings the aside shows,
// and a second implementation is a second escaping decision to get wrong.
export function formatPath(path) {
  // An analysis writes a version's paths as plain strings; only much older records
  // carry {path}. Reading `.path` unconditionally rendered nothing at all for every
  // path in the dependency aside and the component detail.
  const location = pathLocation(path);
  if (!location) return '';
  if (location === '/') return '<i class="fa fa-angle-right"></i>';
  return escapeHtml(location).replace(/(\/)/g, ' <i class="fa fa-angle-right"></i> ');
}

// The bare location, for attribute values (title=, data-clipboard-text=) where the
// chevron markup of formatPath does not belong.
Template.registerHelper('pathLocation', pathLocation);

Template.registerHelper('getUrl', function (type) {
  return (this && typeof this.getUrl === 'function') ? this.getUrl(type) : undefined;
});

Template.registerHelper('__', function (key, ...args) {
  return i18n.getTranslation(key, ...args);
});

Template.registerHelper('dateFormat', function (date, format, deflt) {
  if (date instanceof Spacebars.kw) {
    deflt = date.hash.deflt;
    format = date.hash.format;
    date = date.hash.date;
  }

  // http://momentjs.com/docs/#/displaying/format/
  if (format instanceof Spacebars.kw) {
    deflt = format.hash.deflt;
    format = format.hash.format;
  }
  format = format || 'lll';

  if (deflt instanceof Spacebars.kw) {
    deflt = deflt.hash.deflt;
  }

  if (date) {
    const m = moment(date);
    return format === 'fromNow' ? m.fromNow() : m.format(format);
  }
  return deflt || '';
});

Template.registerHelper('dateFromNow', function (date) {
  date = date && moment(date);
  const dateFromNow = date && date.fromNow() || '';
  const dateStr = date && date.format('lll') || '';
  return `<span title='${dateStr}' data-toggle='tooltip'>${dateFromNow}</span>`;
});

Template.registerHelper('checkIcon', function (value, clazz) {
  let html;
  if (!clazz || clazz instanceof Spacebars.kw) {
    clazz = '';
  }
  clazz += ' fa';
  if (value) {
    clazz += ' fa-check-square-o';
    html = '<i style="color: #2a94a2;" class="';
  } else {
    clazz += ' fa-square-o';
    html = '<i class="';
  }
  html += clazz + '"></i>';
  return new Spacebars.SafeString(html);
});

Template.registerHelper('versionsStr', function (versions) {
  let vStr = '';
  if (versions instanceof Array && versions.length > 0) {
    _.each(versions, function (version) {
      if (version) {
        vStr += vStr.length === 0 ? version : ' - ' + version;
      }
    });
  }
  return vStr;
});

Template.registerHelper('licensesStr', function (licenses) {
  let lStr = '';
  if (licenses instanceof Array && licenses.length > 0) {
    _.each(licenses, function (license) {
      if (license && license.name) {
        lStr += lStr.length === 0 ? license.name : ' ' + license.name;
      }
    });
  }
  return lStr;
});

Template.registerHelper('licensesListHtml', function (licenses) {
  let list = [];
  if (licenses instanceof Array && licenses.length > 0) {
    _.each(licenses, function (license) {
      if (license && license.name) {
        list.push(license)
      }
    });
  }
  return list;
});

Template.registerHelper('cryptoAlgorithmsListHtml', function (crypto_algorithms) {
  let list = [];
  if (crypto_algorithms instanceof Array && crypto_algorithms.length > 0) {
    _.each(crypto_algorithms, function (item) {
      if (item && item.algorithm) {
        list.push(item)
      }
    });
  }
  return list;
});

Template.registerHelper('metaStr', function (meta) {
  let lStr = '';
  if (meta) {
    lStr = JSON.stringify(meta, null, 2)
  }
  return lStr;
});

Template.registerHelper('prettyJsonStr', function (meta) {
  let lStr = '';
  if (meta) {
    lStr = JSON.stringify(JSON.parse(meta), null, 2)
  }
  return lStr;
});

Template.registerHelper('equals', function (op1, op2) {
  return op1 === op2;
});

Template.registerHelper('session', function (input) {
  return Session.get(input);
});

Template.registerHelper('errorMsg', function () {
  return Session.get('errorMsg');
});

// Total feed requests of a public release or CSAF key
Template.registerHelper('requestCount', function (key) {
  return requestCount(key);
});

/* Compact page header flag, read by pageHeader */
Template.registerHelper('small', function () {
  return Session.get('small');
});

Template.registerHelper('stringify', function (o) {
  if (!o || o instanceof Spacebars.kw) {
    o = this;
  }

  return JSON.stringify(o);
});

Template.registerHelper('upDownIcon', function (value) {
  const icon = value > 0 ? 'fa-level-up' : 'fa-level-down';
  return value === 0 ? '' : `<i class="fa ${icon} text-success">`;
});

// COTS and infrastructure components carry Mongo ObjectIds, and pathFor would
// stringify one into ObjectID("<hex>"). Use as {{pathFor 'route' _id=(urlId _id)}}.
Template.registerHelper('urlId', function (id) {
  return idParam(id);
});

Template.registerHelper('getPkgMgrIcon', function (key, inline) {
  try {
    const compKey = new Utils.ComponentKey(key, {mgr: true, component: true});
    let href, logo;
    if (compKey.manager === 'mvn' || compKey.manager === 'maven') {
      const parts = compKey.component.split(':');
      href = `http://search.maven.org/#search|gav|1|g:${parts[0]} AND a:${parts[1]}`;
      logo = '/images/maven-logo.svg';
    } else if (compKey.manager === 'npm') {
      href = 'http://npm.im/' + compKey.component;
      logo = '/images/npm-logo.svg';
    } else if (compKey.manager === 'bower') {
      href = 'http://bower.io/search/?q=' + compKey.component;
      logo = '/images/bower-logo.svg';
    } else if (compKey.manager === 'nuget' || compKey.manager === 'netcore' || compKey.manager === 'netframework') {
      href = 'https://www.nuget.org/packages/' + compKey.component;
      logo = '/images/nuget-logo.svg';
    } else if (compKey.manager === 'atm') {
      if(compKey.component.indexOf(':') === -1){
        href = 'https://packosphere.com/meteor/' + compKey.component
      }else{
        href = 'https://packosphere.com/' + compKey.component.replace(':', '/');
      }
      logo = '/images/meteor-logo.svg';
    } else if (compKey.manager === 'pip' || compKey.manager === 'pypi') {
      href = 'https://pypi.python.org/pypi/' + compKey.component.replace(':', '/');
      logo = '/images/pip-logo.svg';
    } else if (compKey.manager === 'php' || compKey.manager === 'composer') {
      href = 'https://packagist.org/packages/' + compKey.component.replace(':', '/');
      logo = '/images/php-logo.svg';
    } else if (compKey.manager === 'ruby' || compKey.manager === 'bundler') {
      href = 'https://rubygems.org/gems/' + compKey.component.replace(':', '/');
      logo = '/images/ruby-logo.svg';
    } else if (compKey.manager === 'deb') {
      href = 'https://packages.debian.org/search?keywords=' + compKey.component.replace(':', '/');
      logo = '/images/deb.png';
    } else if (compKey.manager === 'alpine') {
      href = 'https://pkgs.alpinelinux.org/packages?name=' + compKey.component.replace(':', '/');
      logo = '/images/alpinelinux-logo.svg';
    } else if (compKey.manager === 'apk') {
      // apk keys carry the distro as a namespace ('apk:alpine:7zip'), which the
      // package search does not take - it wants the bare package name.
      const apkParts = compKey.component.split(':');
      href = 'https://pkgs.alpinelinux.org/packages?name=' + apkParts[apkParts.length - 1];
      logo = '/images/alpinelinux-logo.svg';
    } else if (compKey.manager === 'go' || compKey.manager === 'golang') {
      // Both spellings are valid key prefixes (see packageTypes.js), so both
      // must resolve here or a 'golang:' key falls through to the placeholder.
      href = 'https://pkg.go.dev/search?q=' + compKey.component.replace(':', '/');
      logo = '/images/go.png';
    } else if (compKey.manager === 'cargo') {
      href = 'https://crates.io/crates/' + compKey.component.replace(':', '/');
      logo = '/images/cargo-logo.svg';
    } else if (compKey.manager === 'pub') {
      href = 'https://pub.dev/packages/' + compKey.component.replace(':', '/');
      logo = '/images/dart-logo.svg';
    } else {
      href = false;
      logo = '/images/package_code.png';
    }

    const displayStyle = inline ? 'display: inline;' : 'display: block;';
    const imgClass = inline ? '' : 'center-block';
    const imgStyle = inline ? 'display: inline-block;vertical-align: middle;' : '';
    return href ? `<a target='_blank' title='visit paketmanager' href='${escapeHtml(href)}'
          style="width: 70px; ${displayStyle}">
          <img class='img-responsive ${imgClass}' src='${escapeHtml(logo)}'
          style="max-height: 20px;max-width: 60px; ${imgStyle}"></a>` : '';
  } catch (error) {
    console.log('unable to parse key: %s', key, error);
  }
  return '';
});

Template.registerHelper('classIf', function (className, bool) {
  return bool ? className : '';
});

Template.registerHelper('classUnless', function (className, bool) {
  return !bool ? className : '';
});

