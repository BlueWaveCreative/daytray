// Consent page for Connected agents. Plain JS, no libraries.
// Starts a request, shows a short code, then waits for the person to approve it in Daytray.
(function () {
  "use strict";

  var cfg = window.DAYTRAY_AGENT || {};
  var POLL_MS = 2000;
  var MAX_WAIT_MS = 10 * 60 * 1000;
  var PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method",
                "state", "scope", "resource"];

  function $(id) { return document.getElementById(id); }

  function show(which) {
    ["loading", "problem", "ready"].forEach(function (id) { $(id).hidden = id !== which; });
  }

  function problem(text) {
    $("title").textContent = "Daytray";
    $("problem-text").textContent = text;
    show("problem");
  }

  function postJSON(path, body) {
    return fetch(cfg.issuer + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        return { ok: res.ok, status: res.status, json: json };
      });
    });
  }

  // Only ever send the person back to the address we showed them.
  function safeTarget(url, host) {
    try {
      var u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (u.hostname !== host) return null;
      return u.href;
    } catch (e) { return null; }
  }

  function start() {
    if (!cfg.issuer || !cfg.approveLink) return problem("This page is not set up yet. Go back to Claude and try again later.");
    var q = new URLSearchParams(location.search), body = {};
    PARAMS.forEach(function (k) { if (q.has(k)) body[k] = q.get(k); });
    if (!body.client_id || !body.redirect_uri) {
      return problem("Start from Claude. In Claude, add the Daytray connector and choose Connect.");
    }
    postJSON("/authorize/start", body).then(function (r) {
      if (!r.ok || !r.json || !r.json.request_secret) {
        var d = r.json && r.json.error;
        if (d === "busy") return problem("Daytray is busy right now. Wait a minute, then go back to Claude and connect again.");
        if (d === "disabled") return problem("Connecting agents to Daytray is switched off for now.");
        return problem("Daytray could not start this connection. Go back to Claude and connect again.");
      }
      begin(r.json);
    }, function () {
      problem("Daytray could not be reached. Check your connection, then go back to Claude and connect again.");
    });
  }

  function begin(info) {
    // The secret stays in this variable only. It is never put in the page, the address or storage.
    var secret = info.request_secret;
    var display = String(info.display_code || "");
    var plain = display.toUpperCase().replace(/[^A-Z0-9]/g, "");
    var host = String(info.redirect_host || "");
    var link = cfg.approveLink + "?code=" + encodeURIComponent(plain);

    document.title = "Connect to Daytray";
    $("title").textContent = (info.client_name || "An app") + " wants to connect to Daytray";
    $("code").textContent = display;
    $("open").href = link;
    $("goes-back").textContent = "When you approve, you go back to " + host + ".";
    $("loopback").hidden = !info.loopback;
    try { $("qr").appendChild(window.DaytrayQR.toSvg(link, document)); }
    catch (e) { $("qr").hidden = true; }
    show("ready");

    var started = Date.now();
    var misses = 0;

    function finish(text) {
      secret = null;
      $("waiting").textContent = text;
    }

    function expired() {
      secret = null;
      problem("This code expired. Go back to Claude and connect again.");
    }

    function leave(redirectTo, message) {
      var target = safeTarget(redirectTo, host);
      if (!target) return problem("Daytray could not send you back. Go back to Claude and connect again.");
      finish(message);
      location.replace(target);
    }

    function tick() {
      if (!secret) return;
      if (Date.now() - started > MAX_WAIT_MS) return expired();
      postJSON("/authorize/poll", { request_secret: secret }).then(function (r) {
        if (!r.ok) throw new Error("poll");
        misses = 0;
        var s = r.json && r.json.status;
        if (s === "approved") return leave(r.json.redirect_to, "Approved. Going back to " + host + ".");
        if (s === "denied") {
          finish("You chose not to connect.");
          return setTimeout(function () { leave(r.json.redirect_to, "You chose not to connect."); }, 1200);
        }
        if (s === "expired") return expired();
        if (s === "unknown") return problem("Daytray lost track of this request. Go back to Claude and connect again.");
        setTimeout(tick, POLL_MS);
      }).catch(function () {
        misses++;
        if (misses >= 3) $("waiting").textContent = "Trying to reach Daytray again.";
        setTimeout(tick, POLL_MS);
      });
    }
    setTimeout(tick, POLL_MS);
  }

  start();
})();
