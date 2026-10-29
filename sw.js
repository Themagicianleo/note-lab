// sw.js: the service worker that makes Note Lab work offline.
// ------------------------------------------------------------
// 1. On install, save every file the app needs into a cache.
// 2. For each request: try the network first (so you always get the latest
//    version when online), save the fresh copy, and if the network fails
//    (offline), answer from the cache instead.
//
// When you change the app's files, bump VERSION so old caches are removed.
// tests/service-worker.test.js checks that FILES lists every app file.
// ------------------------------------------------------------

const VERSION = 'note-lab-v5'; // v5: higher sensitivity (band filter, automatic threshold)

const FILES = [
  './',
  'index.html',
  'how-it-works.html',
  'manifest.json',
  'css/glass.css',
  'css/style.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/acoustics.js',
  'js/app.js',
  'js/audio-input.js',
  'js/autocorrelation.js',
  'js/ear-training.js',
  'js/file-analysis.js',
  'js/filters.js',
  'js/fft.js',
  'js/interval-trainer-view.js',
  'js/key-finder.js',
  'js/key-listener.js',
  'js/lab/beats-view.js',
  'js/lab/canvas.js',
  'js/lab/colour-map.js',
  'js/lab/harmonics-view.js',
  'js/lab/key-view.js',
  'js/lab/lab.js',
  'js/lab/pipe-view.js',
  'js/lab/reality-view.js',
  'js/lab/room-view.js',
  'js/lab/rt60-view.js',
  'js/lab/spectrogram-view.js',
  'js/lab/waveform-view.js',
  'js/level-meter.js',
  'js/level.js',
  'js/monitor-graph.js',
  'js/monitor-view.js',
  'js/monitor-window.js',
  'js/noise-floor.js',
  'js/note-trainer-view.js',
  'js/pitch-history.js',
  'js/pitch-math.js',
  'js/pitch-stats.js',
  'js/pitch-tracker.js',
  'js/range-finder.js',
  'js/recorder.js',
  'js/register-sw.js',
  'js/scales.js',
  'js/settings-view.js',
  'js/settings.js',
  'js/singback-view.js',
  'js/smoothing.js',
  'js/spectrum-view.js',
  'js/spectrum.js',
  'js/storage.js',
  'js/tone-player.js',
  'js/trainer-ui.js',
  'js/tuner-view.js',
  'js/voice-ranges.js',
  'js/voice-types.js',
  'js/voice-view.js',
  'js/yin.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
  self.skipWaiting(); // use the new version straight away
});

self.addEventListener('activate', (event) => {
  // Delete caches from older versions.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle our own files (GET requests on this site).
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('index.html'); // any page → the app
        return Response.error();
      })
  );
});
