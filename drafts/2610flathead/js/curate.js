/* ?edit=1 curation editor (Caleb's draft-review design, wired 2026-10-22). A right rail over the
   SAME rendered draft. The draft build is the scan: everything found is listed here.
     - sections on/off (Summary / Map / 360 / Orthos / Photos / Documents)
     - every official DOCUMENT found (each 213RR, the HASP, the 205A...) on/off
     - every recon PHOTO on/off (stable key "<oid>:<attachment id>"), orthos + 360s on/off
     - ADD PHOTOS (uploaded to the admin -> Drive; the builder freezes them into the gallery)
     - RECIPIENTS of the published-package email (Employees roster + extra addresses)
   Save -> admin package-curate (stores curation_json). Publish -> admin package-publish (stores it
   and queues the final build). Both are checked against the row's draft PIN server-side.
   The roster / saved recipients come from the admin AFTER the PIN -- never from the public files. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
  var MAX_UPLOAD = 10 * 1024 * 1024;

  window.initCuration = function (data) {
    document.body.classList.add("editing");
    var pin = sessionStorage.getItem("wri_pkg_pin_" + data.slug) || "";
    var server = { roster: [], default_recipients: [] };
    var state = {
      sections: Object.assign({ summary: true, map: true, panos: true, orthos: true, photos: true, documents: true },
                              data.sections || {}),
      exclude: { docs: {}, photos: {}, orthos: {}, panos: {} },
      added: [],                         // {file_id, name, caption, url(local preview), status}
      addGrp: [],                        // GRP Capture sites added by search {oid, site_code, site_name}
      recipients: {}                     // email -> true
    };

    function api(name, extra) {
      var body = Object.assign({ api: name, slug: data.slug, request_id: data.request_gid, pin: pin }, extra || {});
      return fetch(data.dispatch_url, { method: "POST", body: JSON.stringify(body) })
        .then(function (r) { return r.json(); });
    }

    var photos = (data.photos || []).map(function (p, i) { return { id: String(p.key || i), p: p }; });
    var docs = data.doc_candidates || [];
    var docGroups = [];
    docs.forEach(function (d) {
      var g = docGroups.find(function (x) { return x.key === d.key; });
      if (!g) { g = { key: d.key, section: d.section, items: [] }; docGroups.push(g); }
      g.items.push(d);
    });

    var el = document.createElement("aside");
    el.id = "curate";
    el.innerHTML =
      '<header>Edit package</header>' +
      '<div class="body">' +
        '<div class="hint">Everything found for this incident is listed. Untick what should NOT be in the published package and briefing PDF, add photos, pick who gets the email, then Publish.</div>' +
        '<div class="csec"><div class="lbl ttl">Sections</div>' +
          ((data.manifest && data.manifest.sections) || []).map(function (s) {
            return '<label class="crow"><input type="checkbox" data-sec="' + esc(s.key) + '"' +
              (state.sections[s.key] !== false ? ' checked' : '') + '><span class="lbl">' + esc(s.label) + '</span>' +
              (s.count != null ? '<span class="ct">' + esc(s.count) + '</span>' : '') + '</label>';
          }).join('') + '</div>' +
        (docGroups.length ? '<div class="csec"><div class="lbl ttl">Documents <span class="ct">' + docs.length + '</span></div>' +
          docGroups.map(function (g) {
            return '<div class="dgrp"><div class="dsec">' + esc(g.section) + '</div>' + g.items.map(function (d) {
              return '<label class="irow"><input type="checkbox" data-doc="' + esc(d.id) + '" checked><span>' +
                esc(d.title !== d.section ? d.title : d.section) + '</span></label>';
            }).join('') + '</div>';
          }).join('') + '</div>' : '') +
        '<div class="csec"><div class="lbl ttl">Add a GRP Capture sheet</div>' +
          '<div class="hint" style="margin:0 0 6px">Nearby GRP sheets are listed above. Updates elsewhere on the river can be added by site name or code.</div>' +
          '<input type="text" id="grpQ" class="rcptx" placeholder="Search site name or code, e.g. Belton or MFF-10">' +
          '<div id="grpRes"></div><div id="grpAdded"></div>' +
        '</div>' +
        (photos.length ? '<div class="csec"><div class="lbl ttl">Photos <span class="ct">' + photos.length + '</span></div>' +
          '<div class="pgrid">' + photos.map(function (ph) {
            return '<label class="pcell"><img loading="lazy" src="' + esc(ph.p.thumb || ph.p.src) + '" alt="">' +
              '<input type="checkbox" data-photo="' + esc(ph.id) + '" checked></label>';
          }).join('') + '</div></div>' : '') +
        itemList("orthos", "Drone orthos", (data.orthos || []).map(function (o) { return { id: String(o.id), label: o.name || "Ortho" }; })) +
        itemList("panos", "360° panoramas", (data.panos || []).map(function (p) { return { id: String(p.id), label: (p.name || "Panorama") + (p.site_label ? " · " + p.site_label : "") }; })) +
        '<div class="csec add"><div class="lbl ttl">Add photos</div>' +
          '<div class="hint" style="margin:0 0 6px">Photos or diagrams that aren’t on the map — they’ll appear in the Photos gallery and the briefing.</div>' +
          '<label class="drop" id="drop"><input type="file" id="addfiles" accept="image/*" multiple hidden>+ Choose images</label>' +
          '<div id="addedlist"></div>' +
        '</div>' +
        '<div class="csec"><div class="lbl ttl">Email the published package to</div>' +
          '<div id="rcptList" class="hint">Loading the staff list…</div>' +
          '<input type="text" id="rcptExtra" class="rcptx" placeholder="Other addresses, comma-separated">' +
        '</div>' +
        '<div id="curMsg" class="hint"></div>' +
      '</div>' +
      '<footer><button class="btn" id="curSave">Save</button><button class="btn primary" id="curPublish">Publish</button></footer>';
    document.body.appendChild(el);

    function itemList(kind, label, items) {
      if (!items.length) return '';
      return '<div class="csec"><div class="lbl ttl">' + esc(label) + ' <span class="ct">' + items.length + '</span></div>' +
        items.map(function (it) {
          return '<label class="irow"><input type="checkbox" data-item="' + kind + '" data-id="' + esc(it.id) + '" checked><span>' + esc(it.label) + '</span></label>';
        }).join('') + '</div>';
    }
    function sel(attr, id) { return '[' + attr + '="' + String(id).replace(/["\\]/g, '\\$&') + '"]'; }
    function msg(t, bad) { var m = $("curMsg"); m.textContent = t || ""; m.style.color = bad ? "#EC2329" : ""; }

    // ---- wiring: every toggle previews live on the page behind the rail
    el.querySelectorAll("input[data-sec]").forEach(function (cb) {
      cb.onchange = function () {
        state.sections[cb.dataset.sec] = cb.checked;
        var sec = $("sec-" + cb.dataset.sec);
        if (sec) sec.style.opacity = cb.checked ? "" : ".35";
      };
    });
    el.querySelectorAll("input[data-doc]").forEach(function (cb) {
      cb.onchange = function () {
        state.exclude.docs[cb.dataset.doc] = !cb.checked;
        document.querySelectorAll(".docrow" + sel("data-doc", cb.dataset.doc)).forEach(function (n) { n.classList.toggle("off", !cb.checked); });
      };
    });
    el.querySelectorAll("input[data-photo]").forEach(function (cb) {
      cb.onchange = function () {
        state.exclude.photos[cb.dataset.photo] = !cb.checked;
        cb.parentNode.classList.toggle("off", !cb.checked);
        document.querySelectorAll("#gallery " + sel("data-photo", cb.dataset.photo)).forEach(function (n) { n.style.display = cb.checked ? "" : "none"; });
      };
    });
    el.querySelectorAll("input[data-item]").forEach(function (cb) {
      cb.onchange = function () {
        state.exclude[cb.dataset.item][cb.dataset.id] = !cb.checked;
        var attr = cb.dataset.item === "orthos" ? "data-ortho" : "data-pano";
        document.querySelectorAll(sel(attr, cb.dataset.id)).forEach(function (n) { n.style.display = cb.checked ? "" : "none"; });
      };
    });

    // ---- add photos: upload now (admin -> Drive), keep the returned file id
    function addFiles(files) {
      Array.prototype.forEach.call(files, function (f) {
        if (!/^image\//.test(f.type)) return;
        if (f.size > MAX_UPLOAD) { msg(f.name + " is over 10 MB — skipped", true); return; }
        var row = { name: f.name, caption: "", url: URL.createObjectURL(f), file_id: null, status: "uploading…" };
        state.added.push(row);
        renderAdded();
        var rd = new FileReader();
        rd.onload = function () {
          api("package-upload", { name: f.name, mime: f.type, data_b64: String(rd.result).split(",")[1] })
            .then(function (j) {
              if (j && j.ok && j.file_id) { row.file_id = j.file_id; row.status = "uploaded"; }
              else { row.status = "failed: " + ((j && j.error) || "upload error"); }
              renderAdded();
            })
            .catch(function (e) { row.status = "failed: " + e.message; renderAdded(); });
        };
        rd.readAsDataURL(f);
      });
    }
    function renderAdded() {
      $("addedlist").innerHTML = state.added.map(function (a, i) {
        return '<div class="addrow">' + (a.url ? '<img src="' + esc(a.url) + '" alt="">' : '') +
          '<div class="addmeta"><div>' + esc(a.name) + ' <span class="ct">' + esc(a.status || "") + '</span></div>' +
          '<input type="text" class="cap" data-i="' + i + '" placeholder="Caption (optional)" value="' + esc(a.caption) + '"></div>' +
          '<button class="rm" data-i="' + i + '" title="Remove">×</button></div>';
      }).join("");
      $("addedlist").querySelectorAll("input.cap").forEach(function (inp) { inp.oninput = function () { state.added[+inp.dataset.i].caption = inp.value; }; });
      $("addedlist").querySelectorAll("button.rm").forEach(function (b) { b.onclick = function () { state.added.splice(+b.dataset.i, 1); renderAdded(); }; });
    }
    $("drop").onclick = function () { $("addfiles").click(); };
    $("addfiles").onchange = function () { addFiles(this.files); this.value = ""; };
    $("drop").addEventListener("dragover", function (e) { e.preventDefault(); $("drop").classList.add("over"); });
    $("drop").addEventListener("dragleave", function () { $("drop").classList.remove("over"); });
    $("drop").addEventListener("drop", function (e) { e.preventDefault(); $("drop").classList.remove("over"); addFiles(e.dataTransfer.files); });

    // ---- GRP Capture search (admin package-grp-search, after the PIN)
    var grpTimer = null;
    function renderGrpAdded() {
      $("grpAdded").innerHTML = state.addGrp.map(function (g, i) {
        return '<div class="irow"><span>✓ ' + esc(g.site_name) + ' <span class="ct">' + esc(g.site_code) + '</span></span>' +
          '<button class="xpand" data-rmgrp="' + i + '">remove</button></div>';
      }).join("");
      $("grpAdded").querySelectorAll("[data-rmgrp]").forEach(function (b) {
        b.onclick = function (e) { e.preventDefault(); state.addGrp.splice(+b.dataset.rmgrp, 1); renderGrpAdded(); };
      });
    }
    $("grpQ").oninput = function () {
      clearTimeout(grpTimer);
      var q = $("grpQ").value.trim();
      if (q.length < 2) { $("grpRes").innerHTML = ""; return; }
      grpTimer = setTimeout(function () {
        $("grpRes").innerHTML = '<div class="hint">Searching…</div>';
        api("package-grp-search", { q: q }).then(function (j) {
          if (!j || !j.ok) { $("grpRes").innerHTML = '<div class="hint">' + esc((j && j.error) || "search failed") + '</div>'; return; }
          var res = (j.results || []).filter(function (r) { return !state.addGrp.some(function (g) { return g.oid === r.oid; }); });
          $("grpRes").innerHTML = res.length ? res.map(function (r, i) {
            return '<div class="irow"><span>' + esc(r.site_name) + ' <span class="ct">' + esc(r.site_code) +
              (r.revises ? ' · updates ' + esc(r.revises) : '') + '</span></span><button class="xpand" data-addgrp="' + i + '">add</button></div>';
          }).join("") : '<div class="hint">No finished GRP Capture sheets match.</div>';
          $("grpRes").querySelectorAll("[data-addgrp]").forEach(function (b) {
            b.onclick = function (e) {
              e.preventDefault();
              var r = res[+b.dataset.addgrp];
              state.addGrp.push({ oid: r.oid, site_code: r.site_code, site_name: r.site_name });
              b.parentNode.remove();
              renderGrpAdded();
            };
          });
        }).catch(function (e) { $("grpRes").innerHTML = '<div class="hint">' + esc(e.message) + '</div>'; });
      }, 350);
    };

    // ---- recipients (roster from the admin, after the PIN)
    function rosterEmails() {
      var known = {};
      (server.roster || []).forEach(function (r) { var e = String((r && r.email) || "").toLowerCase(); if (EMAIL.test(e)) known[e] = true; });
      return known;
    }
    function renderRecipients() {
      var known = rosterEmails();
      var rows = (server.roster || []).filter(function (r) { return r && EMAIL.test(String(r.email || "").toLowerCase()); }).map(function (r) {
        var e = String(r.email).toLowerCase();
        return '<label class="irow"><input type="checkbox" data-rcpt="' + esc(e) + '"' + (state.recipients[e] ? " checked" : "") + '><span>' +
          esc(r.name || e) + ' <span class="ct">' + esc(e) + '</span></span></label>';
      });
      $("rcptList").className = "";
      $("rcptList").innerHTML = rows.join("") || '<div class="hint">No staff list available — type addresses below.</div>';
      $("rcptList").querySelectorAll("input[data-rcpt]").forEach(function (cb) {
        cb.onchange = function () { state.recipients[cb.dataset.rcpt] = cb.checked; };
      });
      $("rcptExtra").value = Object.keys(state.recipients).filter(function (e) { return state.recipients[e] && !known[e]; }).join(", ");
    }
    function recipients() {
      var known = rosterEmails();
      var out = Object.keys(state.recipients).filter(function (e) { return state.recipients[e] && known[e]; });
      $("rcptExtra").value.split(/[,;\s]+/).forEach(function (e) {
        e = e.trim().toLowerCase();
        if (EMAIL.test(e) && out.indexOf(e) < 0) out.push(e);
      });
      return out;
    }

    // ---- restore the saved selection (admin, after the PIN)
    function applySaved(c) {
      if (!c) return;
      if (c.sections) Object.keys(c.sections).forEach(function (k) {
        var cb = el.querySelector("input" + sel("data-sec", k)); if (cb) { cb.checked = c.sections[k] !== false; cb.onchange(); }
      });
      var ex = c.exclude || {};
      (ex.docs || []).forEach(function (id) { var cb = el.querySelector("input" + sel("data-doc", id)); if (cb) { cb.checked = false; cb.onchange(); } });
      (ex.photos || []).forEach(function (id) { var cb = el.querySelector("input" + sel("data-photo", id)); if (cb) { cb.checked = false; cb.onchange(); } });
      ["orthos", "panos"].forEach(function (k) {
        (ex[k] || []).forEach(function (id) { var cb = el.querySelector('input[data-item="' + k + '"]' + sel("data-id", id)); if (cb) { cb.checked = false; cb.onchange(); } });
      });
      (c.added_images || []).forEach(function (a) {
        if (a && a.file_id && !state.added.some(function (x) { return x.file_id === a.file_id; }))
          state.added.push({ name: a.name || "photo", caption: a.caption || "", file_id: a.file_id, url: "", status: "uploaded" });
      });
      renderAdded();
      (c.add_grp || []).forEach(function (g) { if (g && g.oid) state.addGrp.push(g); });
      renderGrpAdded();
    }
    el.querySelectorAll("input[data-sec]").forEach(function (cb) { cb.onchange(); });
    api("package-pin", { want: "curate" }).then(function (j) {
      if (!j || !j.ok) { msg("PIN not accepted — reload and enter it again.", true); renderRecipients(); return; }
      server.roster = j.roster || [];
      server.default_recipients = j.default_recipients || [];
      var saved = null;
      try { saved = j.curation_json ? JSON.parse(j.curation_json) : null; } catch (e) { saved = null; }
      var rc = (saved && saved.recipients && saved.recipients.length) ? saved.recipients : server.default_recipients;
      rc.forEach(function (e) { state.recipients[String(e).toLowerCase()] = true; });
      applySaved(saved);
      renderRecipients();
    }).catch(function (e) { msg("Could not reach the Incident Admin: " + e.message, true); renderRecipients(); });

    // ---- save / publish
    function curationJson() {
      var on = function (m) { return Object.keys(m).filter(function (k) { return m[k]; }); };
      return {
        version: 2, sections: state.sections,
        exclude: { docs: on(state.exclude.docs), photos: on(state.exclude.photos),
                   orthos: on(state.exclude.orthos), panos: on(state.exclude.panos) },
        added_images: state.added.filter(function (a) { return a.file_id; })
          .map(function (a) { return { file_id: a.file_id, name: a.name, caption: a.caption }; }),
        add_grp: state.addGrp,
        recipients: recipients()
      };
    }
    function busy(b) { $("curSave").disabled = b; $("curPublish").disabled = b; }
    function pendingUploads() { return state.added.some(function (a) { return !a.file_id && /uploading/.test(a.status); }); }

    $("curSave").onclick = function () {
      if (pendingUploads()) { msg("Wait for the photo uploads to finish.", true); return; }
      busy(true); msg("Saving…");
      api("package-curate", { curation_json: JSON.stringify(curationJson()) })
        .then(function (j) { msg(j && j.ok ? "Saved." : "Save failed: " + ((j && j.error) || "unknown"), !(j && j.ok)); })
        .catch(function (e) { msg("Save failed: " + e.message, true); })
        .then(function () { busy(false); });
    };
    $("curPublish").onclick = function () {
      if (pendingUploads()) { msg("Wait for the photo uploads to finish.", true); return; }
      var c = curationJson();
      if (!c.recipients.length && !confirm("No one is selected to receive the email. Publish anyway?")) return;
      if (!confirm("Publish this package with the current selection?\n\nThe public page goes live and " +
                   (c.recipients.length ? c.recipients.length + " recipient(s) get the email." : "only the default Incident Admin address gets the email."))) return;
      busy(true); msg("Publishing…");
      api("package-publish", { curation_json: JSON.stringify(c) })
        .then(function (j) {
          if (j && j.ok) msg("Publish queued — the final package builds in a few minutes; the Incident Admin shows when it's done.");
          else { msg("Publish failed: " + ((j && j.error) || "unknown"), true); busy(false); }
        })
        .catch(function (e) { msg("Publish failed: " + e.message, true); busy(false); });
    };
  };
})();
