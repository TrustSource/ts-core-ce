// The company logo is kept as a data URI in `logoBase64`: the General info page shows it as a
// preview and the PDF reports embed it. pdfmake renders only PNG and JPEG, so the format is read
// from the file signature, never from a Content-Type header or the URL's extension, and anything
// else is refused. The size cap keeps the company document small, because every page load reads it.
//
// logoDataUri(bytes) -> 'data:image/png;base64,...' | 'data:image/jpeg;base64,...' | null
//
// Plain CommonJS with no imports so the server method and Jest share one implementation.

const MAX_LOGO_BYTES = 512 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

// A Buffer is a Uint8Array; the tag check works across realms (Jest, vm), instanceof does not.
function isByteArray(value) {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function logoDataUri(bytes) {
  if (!isByteArray(bytes) || bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) {
    return null;
  }
  let mime = null;
  if (startsWith(bytes, PNG_SIGNATURE)) {
    mime = 'image/png';
  } else if (startsWith(bytes, JPEG_SIGNATURE)) {
    mime = 'image/jpeg';
  }
  if (!mime) return null;
  return 'data:' + mime + ';base64,' + Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

module.exports = {logoDataUri, MAX_LOGO_BYTES};
