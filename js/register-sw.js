// register-sw.js
// ------------------------------------------------------------
// Turns on offline use by registering the service worker (sw.js): a small
// script the browser keeps, which saves the app's files and serves them
// when there's no internet. Only the app's own files are saved; no audio,
// nothing about you.
// ------------------------------------------------------------

export function registerServiceWorker(statusElement) {
  const show = (text) => { if (statusElement) statusElement.textContent = text; };
  if (!('serviceWorker' in navigator)) {
    show('Offline use isn\'t available in this browser.');
    return;
  }
  navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => show('Ready to work offline.'))
    .catch(() => show('Offline use couldn\'t be set up (the app still works online).'));
}
