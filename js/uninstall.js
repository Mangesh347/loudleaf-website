(function () {
  "use strict";
  var form = document.getElementById("feedbackForm");
  var btn = document.getElementById("sendBtn");
  var status = document.getElementById("formStatus");
  var version = new URLSearchParams(location.search).get("v") || "";

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var picked = form.querySelector('input[name="reason"]:checked');
    var detail = document.getElementById("detail").value.trim();
    if (!picked && !detail) {
      status.textContent = "Pick a reason or write a note first.";
      return;
    }
    btn.disabled = true;
    status.textContent = "Sending…";
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: picked ? picked.value : "other", detail: detail, version: version })
    })
      .then(function (r) {
        if (!r.ok) throw new Error();
        form.querySelectorAll("input, textarea").forEach(function (el) { el.disabled = true; });
        status.textContent = "Thanks. Every answer gets read.";
      })
      .catch(function () {
        btn.disabled = false;
        status.textContent = "That didn't send. Check your connection, or email support@fenwicklabs.app.";
      });
  });
})();
