// Load sweetalert from npm and expose as global
import swal from 'sweetalert';

// Wrap swal to default allowOutsideClick to true (close on backdrop click)
var originalSwal = swal;
var wrappedSwal = function () {
  var args = Array.prototype.slice.call(arguments);
  // swal(title, text, type) or swal(options, callback)
  if (args[0] && typeof args[0] === 'object') {
    if (args[0].allowOutsideClick === undefined) {
      args[0].allowOutsideClick = true;
    }
  }
  return originalSwal.apply(this, args);
};
// Copy static methods
Object.keys(originalSwal).forEach(function (key) {
  wrappedSwal[key] = originalSwal[key];
});

window.swal = wrappedSwal;
