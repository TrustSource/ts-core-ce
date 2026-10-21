// Markup for the footer of every mail the app sends, and the support contact the
// account mails point to.
//
// A self-hosted installation names only itself: the app and the address it runs
// at. The operator details (TS_OPERATOR_NAME, TS_SUPPORT_EMAIL, TS_IMPRINT_URL)
// appear only when the administrator set them, and every value is escaped.
//
// CommonJS with no meteor/* imports so Jest can require it directly; footer.js
// feeds it the server settings.
const {escapeHtml} = require('../../lib/html/tableCells');

function present(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

// 'contact <support address>' when one is set, 'contact your administrator' otherwise.
function buildSupportContact(supportEmail) {
  const email = present(supportEmail);
  if (!email) {
    return 'contact your administrator';
  }
  return `contact <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
}

function buildMailFooter({appName, appUrl, operatorName, supportEmail, imprintUrl}) {
  const url = escapeHtml(appUrl);
  let html = '<p>----</p>' +
    `<p>This message was sent by ${escapeHtml(appName)} at <a href="${url}">${url}</a>.</p>`;
  const operator = present(operatorName);
  if (operator) {
    html += `<p>Operated by ${escapeHtml(operator)}</p>`;
  }
  const email = present(supportEmail);
  if (email) {
    html += `<p>Questions? Contact <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>`;
  }
  // Only a web address is linked; anything else (javascript:, data:) is left out.
  const imprint = present(imprintUrl);
  if (imprint && /^https?:\/\//i.test(imprint)) {
    html += `<p><a href="${escapeHtml(imprint)}">Imprint</a></p>`;
  }
  return html;
}

module.exports = {buildMailFooter, buildSupportContact};
