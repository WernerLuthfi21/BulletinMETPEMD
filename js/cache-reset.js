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

  function hardReload(version) {
    try { localStorage.setItem(key, version); } catch (e) {}
    var purge = (window.caches && caches.keys)
      ? caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (name) {
            return caches.delete(name);
          }));
        })
      : Promise.resolve();

    purge.catch(function () {}).then(function () {
      var url = window.location.pathname +
        "?metp=" + encodeURIComponent(version) +
        window.location.hash;
      window.location.replace(url);
    });
  }

  if (previous === build) {
    fetch("version.json?cb=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (v && v.build && v.build !== build) hardReload(v.build);
      })
      .catch(function () {});
    return;
  }

  hardReload(build);
})();