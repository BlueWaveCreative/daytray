// Shows the code from the link so it can be typed into Daytray if the link did not open the app.
(function () {
  var c = new URLSearchParams(location.search).get("code");
  if (!c) return;
  c = c.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  if (c.length === 8) c = c.slice(0, 4) + "-" + c.slice(4);
  var el = document.getElementById("code");
  el.textContent = c;
  el.hidden = false;
})();
