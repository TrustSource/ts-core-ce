import {parseString} from 'xml2js';

// xml2js result → xml-js compact format
function convertNode(key, value) {
  if (typeof value === 'string') {
    return {type: 'element', name: key, elements: [{type: 'text', text: value}]};
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map(item => {
    const el = {type: 'element', name: key};
    if (item.$) el.attributes = {...item.$};
    const children = [];
    if (item._ !== undefined) children.push({type: 'text', text: String(item._)});
    for (const [k, v] of Object.entries(item)) {
      if (k === '$' || k === '_') continue;
      const sub = Array.isArray(v) ? v : [v];
      for (const s of sub) {
        children.push(...[].concat(convertNode(k, s)));
      }
    }
    if (children.length > 0) el.elements = children;
    return el;
  });
}

export function xml2js(xml) {
  let result;
  parseString(xml, {explicitArray: false, preserveChildrenOrder: true, xmlns: false}, (err, res) => {
    if (err) throw err;
    result = res;
  });
  const elements = [];
  for (const [key, value] of Object.entries(result)) {
    elements.push(...[].concat(convertNode(key, value)));
  }
  return {elements};
}

// xml-js compact format → XML string
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildNode(el, indent, spaces) {
  if (el.type === 'text') return escapeXml(el.text);
  if (el.type !== 'element') return '';
  const pad = ' '.repeat(indent * spaces);
  let attrs = '';
  if (el.attributes) {
    attrs = Object.entries(el.attributes).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
  }
  if (!el.elements || el.elements.length === 0) {
    return `${pad}<${el.name}${attrs}/>`;
  }
  const textOnly = el.elements.every(c => c.type === 'text');
  if (textOnly) {
    const text = el.elements.map(c => escapeXml(c.text)).join('');
    return `${pad}<${el.name}${attrs}>${text}</${el.name}>`;
  }
  const children = el.elements.map(c => buildNode(c, indent + 1, spaces)).join('\n');
  return `${pad}<${el.name}${attrs}>\n${children}\n${pad}</${el.name}>`;
}

export function js2xml(obj, options = {}) {
  const spaces = options.spaces || 0;
  return (obj.elements || []).map(el => buildNode(el, 0, spaces)).join('\n');
}
