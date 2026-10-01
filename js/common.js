// Shared by the document pages: install links + year. (The landing page uses site.js.)
(function () {
  "use strict";
  var STORE_URL = "https://chromewebstore.google.com/search/Loudleaf%20read%20aloud";
  document.querySelectorAll("[data-install]").forEach(function (a) {
    a.href = STORE_URL;
    a.rel = "noopener";
  });
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
