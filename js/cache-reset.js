/* METP deployment cache guard.
   The build token is changed on each deployment. If a browser has an older
   token, discard same-origin CacheStorage entries and reload once so a stale
   asset cannot survive a GitHub Pages update. */
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="metp-build"]');
  var build = meta && meta.content;
  if (!build) return;

  var key = "metp:build";
  var previous = null;
  try { previous = localStorage.getItem(key); } catch (e) {}

  if (previous === build) return;

  try { localStorage.setItem(key, build); } catch (e) {}

  var purge = (window.caches && caches.keys)
    ? caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (name) {
          return caches.delete(name);
        }));
      })
    : Promise.resolve();

  purge.catch(function () {}).then(function () {
    // Cache-busting query strings on the assets handle the normal HTTP cache;
    // this reload only runs once per build token.
    window.location.reload();
  });
})();