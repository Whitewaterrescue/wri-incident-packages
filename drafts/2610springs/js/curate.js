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
    var savedCur = null;                 // the row's curation_json (daily mode: narrative / hours / rates live here)
    var isDaily = !!data.daily;
    var isPrep = !!data.prep;           // BNSF PREP drill package: the drill model lives in curation_json.prep
    if (isPrep) document.body.classList.add("prepmode");
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
        '<div class="hint">' + (isPrep ? 'BNSF drill package ' + esc(data.prep.date) + ': check every pre-filled value, confirm each core component, edit the activities observed and the after-action report, caption the photo log, then Publish. AI-written text is marked AI until you edit it.'
          : isDaily ? 'Daily report ' + esc(data.daily.date) + ': edit the narrative, check hours, receipts and rates, pick photos, documents and recipients, then Publish.'
          : 'Everything found for this incident is listed. Untick what should NOT be in the published package and briefing PDF, add photos, pick who gets the email, then Publish.') + '</div>' +
        (isDaily ? '<div id="dailyPanels" class="hint">Loading the narrative and costs…</div>' : '') +
        (isPrep ? '<div id="prepPanels" class="hint">Loading the drill form…</div>' : '') +
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
        if (isPrep && prp) renderPhotoLog();
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
      savedCur = saved;
      if (isDaily) renderDailyPanels((saved && saved.daily) || null);
      if (isPrep) renderPrepPanels((saved && saved.prep) || null);
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
    // ---- daily mode: narrative + costs (all from the row, after the PIN)
    var dly = null;
    function money(n) { return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function renderDailyPanels(d) {
      var box = $("dailyPanels");
      if (!d) { box.textContent = "The daily data is not ready yet -- rebuild this day from the Incident Admin."; return; }
      dly = { narrative: Object.assign({}, d.narrative_draft || {}, d.narrative || {}), edited: Object.assign({}, d.edited || {}),
              rates: Object.assign({}, d.rates || {}), exclude_hours: (d.exclude_hours || []).slice(),
              exclude_receipts: (d.exclude_receipts || []).slice(), show_costs: d.show_costs !== false };
      var defs = d.rate_defaults || {}, labels = d.rate_labels || {};
      var rate = function (k) { return dly.rates[k] != null && dly.rates[k] !== "" ? Number(dly.rates[k]) : Number(defs[k] || 0); };
      box.className = "";
      box.innerHTML =
        '<div class="csec"><div class="lbl ttl">Narrative <span class="ct">' + (d.narrative_source === "ai" ? "AI draft — review every section" : "template draft") + '</span></div>' +
          (d.sections || []).map(function (s) {
            return '<label class="nlab">' + esc(s[1]) + ' <span class="ct" id="ned-' + esc(s[0]) + '">' + (dly.edited[s[0]] ? "edited ✓" : "") + '</span></label>' +
              '<textarea class="narr" data-nk="' + esc(s[0]) + '" rows="' + (s[0] === "summary" ? 4 : 3) + '">' + esc(dly.narrative[s[0]] || "") + '</textarea>';
          }).join("") + '</div>' +
        '<div class="csec"><div class="lbl ttl">Costs</div>' +
          '<label class="irow"><input type="checkbox" id="showCosts"' + (dly.show_costs ? " checked" : "") + '><span>Show the cost estimate in the client report</span></label>' +
          '<div class="dsec">Rates (' + esc(d.rate_type === "r" ? "response" : d.rate_type === "cal" ? "contract" : "standard") + ' defaults — edit for this report)</div>' +
          Object.keys(defs).map(function (k) {
            return '<label class="rrow"><span>' + esc(labels[k] || k) + '</span><input type="number" step="0.01" data-rate="' + esc(k) + '" value="' + rate(k) + '"></label>';
          }).join("") +
          '<div class="dsec">WRI hours (untick rows that are not this incident)</div>' +
          ((d.hours || []).map(function (h) {
            return '<label class="irow"><input type="checkbox" data-hr="' + esc(h.id) + '"' + (dly.exclude_hours.indexOf(h.id) < 0 ? " checked" : "") + '><span>' +
              esc(h.name) + ' · ' + esc(h.role || h.type || "") + ' · ' + esc(h.hours) + ' h <span class="ct">' + (h.match === "name" ? "matched by project name “" + esc(h.project) + "”" : "") + '</span></span></label>';
          }).join("") || '<div class="hint">No hours recorded for this day.</div>') +
          '<div class="dsec">Receipts</div>' +
          ((d.receipts || []).map(function (r) {
            return '<label class="irow"><input type="checkbox" data-rc="' + esc(r.id) + '"' + (dly.exclude_receipts.indexOf(r.id) < 0 ? " checked" : "") + '><span>' +
              esc(r.type) + ' · ' + esc(r.vendor) + ' · ' + money(r.amount) + ' <span class="ct">' + (r.match === "name" ? "matched by project name" : "") + '</span></span></label>';
          }).join("") || '<div class="hint">No receipts for this day.</div>') +
          '<div class="dsec">Estimate (hours × rate + receipts; per diem added in the report)</div><div id="estTotal" class="hint"></div>' +
        '</div>';
      function recalc() {
        var t = 0, dayRole = {};
        (d.hours || []).forEach(function (h) {      // a role-less row (driving) bills at that person's role that day
          if (dly.exclude_hours.indexOf(h.id) < 0 && h.role && !dayRole[h.name]) dayRole[h.name] = h.role;
        });
        (d.hours || []).forEach(function (h) {
          if (dly.exclude_hours.indexOf(h.id) >= 0) return;
          var k = ({ pm: "PM", lead: "PM", safety: "Safety", tech: "Tech", assistant: "Tech", boatop: "Boat Op", drone: "Drone", uas: "Drone", admin: "Admin" })[String(h.role || dayRole[h.name] || "").toLowerCase().replace(/\s/g, "")] || "Tech";
          t += Number(h.hours || 0) * rate(k);
        });
        (d.receipts || []).forEach(function (r) { if (dly.exclude_receipts.indexOf(r.id) < 0) t += Number(r.amount || 0); });
        $("estTotal").textContent = "≈ " + money(t);
      }
      box.querySelectorAll("textarea[data-nk]").forEach(function (ta) {
        ta.oninput = function () { dly.narrative[ta.dataset.nk] = ta.value; dly.edited[ta.dataset.nk] = true; $("ned-" + ta.dataset.nk).textContent = "edited ✓"; };
      });
      box.querySelector("#showCosts").onchange = function () { dly.show_costs = this.checked; };
      box.querySelectorAll("input[data-rate]").forEach(function (inp) {
        inp.oninput = function () { dly.rates[inp.dataset.rate] = inp.value === "" ? null : Number(inp.value); recalc(); };
      });
      var tog = function (list, id, on) { var i = list.indexOf(id); if (on && i >= 0) list.splice(i, 1); if (!on && i < 0) list.push(id); };
      box.querySelectorAll("input[data-hr]").forEach(function (cb) { cb.onchange = function () { tog(dly.exclude_hours, cb.dataset.hr, cb.checked); recalc(); }; });
      box.querySelectorAll("input[data-rc]").forEach(function (cb) { cb.onchange = function () { tog(dly.exclude_receipts, cb.dataset.rc, cb.checked); recalc(); }; });
      recalc();
    }
    // Save/Publish keep every key already on the row (daily data, results) and merge the edits in
    function fullCuration() {
      var out = Object.assign({}, savedCur || {}, curationJson());
      if (isDaily && dly) {
        var unedited = Object.keys(dly.narrative).filter(function (k) { return !dly.edited[k]; });
        out.daily = Object.assign({}, (savedCur && savedCur.daily) || {}, dly, { unedited_sections: unedited });
      }
      if (isPrep && prp) {
        out.prep = Object.assign({}, (savedCur && savedCur.prep) || {}, {
          doc: prp.doc, edited: Object.keys(prp.edited), notes: prp.notes, captions: prp.captions, photo_order: prp.photo_order });
        out.attach_pdfs = prp.attach;
      }
      return out;
    }

    // ---- prep mode: the BNSF PREP drill form (all from the row, after the PIN)
    var prp = null;
    var STATUS = [["observed", "Observed"], ["not_observed", "Exercised, not observed"], ["na", "N/A"]];
    function prepName(key) { var c = (prp.components || []).find(function (x) { return x[0] === key; }); return c ? c[1] : key; }
    function getP(path) { return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, prp.doc); }
    function setP(path, v) {
      var ks = path.split("."), o = prp.doc;
      for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; }
      o[ks[ks.length - 1]] = v;
    }
    function aiTag(mk) { return prp.marks[mk] === "ai" && !prp.edited[mk] ? ' <span class="ai" data-aitag="' + esc(mk) + '">AI</span>' : ""; }
    // one input bound to a model path; mk = the edit/AI mark key (prep_ai.apply's names)
    function fld(path, label, o) {
      o = o || {};
      var mk = o.mk || path, v = getP(path), id = "pp-" + path.replace(/\W/g, "_");
      if (v == null) v = "";
      var lab = label ? '<label class="nlab" for="' + id + '">' + esc(label) + aiTag(mk) + '</label>' : (o.tagOnly ? aiTag(mk) : "");
      if (o.opts) return lab + '<select id="' + id + '" class="pin" data-pp="' + esc(path) + '" data-mk="' + esc(mk) + '">' +
        o.opts.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(v) === x[0] ? " selected" : "") + '>' + esc(x[1]) + '</option>'; }).join("") + '</select>';
      if (o.area) return lab + '<textarea id="' + id + '" class="narr" rows="' + (o.rows || 3) + '" data-pp="' + esc(path) + '" data-mk="' + esc(mk) + '">' + esc(v) + '</textarea>';
      return lab + '<input id="' + id + '" type="text" class="pin' + (o.cls ? " " + o.cls : "") + '" data-pp="' + esc(path) + '" data-mk="' + esc(mk) + '" value="' + esc(v) + '"' +
        (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>';
    }
    function pills(path, mk) {
      var v = getP(path) || "";
      return '<div class="pills" data-pst="' + esc(path) + '" data-mk="' + esc(mk) + '">' + STATUS.map(function (s) {
        return '<button type="button" class="pill' + (v === s[0] ? " on" : "") + '" data-v="' + s[0] + '">' + s[1] + '</button>';
      }).join("") + aiTag(mk) + '</div>';
    }
    function item(path, mk, name, why) {
      return '<div class="pcard"><div class="pname">' + esc(name) + '</div>' + pills(path + ".status", mk + ".status") +
        (why ? '<div class="why">Evidence: ' + esc(why) + '</div>' : '') +
        fld(path + ".a", "", { area: true, rows: 2, mk: mk + ".a", tagOnly: true }) +
        fld(path + ".b", "", { area: true, rows: 2, mk: mk + ".b", tagOnly: true }) + '</div>';
    }
    function renderPrepPanels(p) {
      var box = $("prepPanels");
      if (!p || !p.doc) { box.textContent = "The drill data is not ready yet -- rebuild this day from the Incident Admin (BNSF drill)."; return; }
      prp = { doc: p.doc, marks: p.marks || {}, edited: {}, notes: p.notes || {}, why: p.why || {}, facts: p.facts || {},
              captions: p.captions || {}, photo_order: (p.photo_order || []).slice(), components: p.components || [],
              ttx: p.ttx_objectives || [], dpx: p.dpx_objectives || [], frp: p.frp_objectives || [], eq: p.eq_questions || [] };
      (p.edited || []).forEach(function (k) { prp.edited[k] = true; });
      prp.attach = ((savedCur && savedCur.attach_pdfs) || []).slice();
      if (!prp.doc.timeline) prp.doc.timeline = [];
      if (!prp.doc.notifications) prp.doc.notifications = [];
      renderPrep();
    }
    function renderPrep() {
      var d = prp.doc, t = (d.type || "DPX").toUpperCase(), isT = t !== "DPX", isD = t !== "TTX", f = prp.facts;
      var sec = function (title, body, open) { return '<details class="psec"' + (open ? " open" : "") + '><summary>' + esc(title) + '</summary>' + body + '</details>'; };
      var html = '<div class="csec"><div class="lbl ttl">BNSF drill form <span class="ct">' +
        (Object.keys(prp.marks).length ? "AI draft + data — review every section" : "pre-filled from the data") + '</span></div>';
      if (!d.site_notes) d.site_notes = { include: true, site: "", place: "", date: "", overview: "", rec_heading: "Observations and Recommendations", rec_intro: "", groups: [], conclusion: "" };
      html += sec("Site Assessment Notes (page 1)",
        '<div class="why">The package opens with this page (same layout as the Hobson / Argentine Yard notes), and the publish email carries it as a Word file too. Blank line = new paragraph; one bullet per line.</div>' +
        '<label class="irow"><input type="checkbox" id="snInc"' + (d.site_notes.include !== false ? " checked" : "") + '><span>Put the Site Assessment Notes first in the package</span></label>' +
        fld("site_notes.site", "Site (title: “<site> – Site Assessment Notes”)", { ph: "e.g. Hobson Yard" }) +
        '<div class="g2"><div>' + fld("site_notes.place", "City, ST", { ph: "Lincoln, NE" }) + '</div><div>' + fld("site_notes.date", "Date", { ph: "October 21, 2026" }) + '</div></div>' +
        fld("site_notes.overview", "Overview", { area: true, rows: 6 }) +
        fld("site_notes.rec_heading", "Section heading", { opts: [["Observations and Recommendations", "Observations and Recommendations"], ["Recommendations", "Recommendations"], ["Observations", "Observations"]] }) +
        fld("site_notes.rec_intro", "Intro line", { area: true, rows: 2, ph: "Discussions with OSROs and BNSF employees produced the following observations and recommendations:" }) +
        '<div class="dsec">Groups' + aiTag("site_notes.groups") + '</div><div id="snGroups"></div>' +
        '<button type="button" class="xpand" id="snAdd">+ add group</button>' +
        fld("site_notes.conclusion", "Conclusion", { area: true, rows: 2 }), true);
      html += sec("Exercise", '<div class="g2">' +
        '<div>' + fld("type", "Type", { opts: [["DPX", "DPX — equipment deployment"], ["TTX", "TTX — table-top"], ["BOTH", "TTX & DPX"]] }) + '</div>' +
        '<div>' + fld("mode", "Exercise type", { opts: [["announced", "Announced"], ["unannounced", "Unannounced"], ["actual", "Actual response"]] }) + '</div></div>' +
        fld("plan_name", "Plan / program name") + '<div class="g2"><div>' + fld("dates", "Date(s)") + '</div><div>' + fld("wcd", "WCD scenario (Y/N)", { opts: [["N", "N"], ["Y", "Y"]] }) + '</div></div>' +
        fld("facility", "Cover page: facility name, state"), true);
      if (isD) html += sec("DPX — summary (Table 4)",
        fld("dpx.locations", "Deployment location(s)") +
        '<div class="g3"><div>' + fld("dpx.start", "Time started", { ph: "0700" }) + '</div><div>' + fld("dpx.on_scene", "Time on scene", { ph: "0800" }) +
        '</div><div>' + fld("dpx.end", "Time completed", { ph: "1630" }) + '</div></div>' +
        fld("dpx.scenario", "Scenario summary", { area: true, rows: 5 }) +
        fld("dpx.strategies", "GRP / ACP strategies deployed", { area: true, rows: 2 }) +
        '<div class="g2"><div>' + fld("dpx.owner", "Equipment owner", { opts: [["", "—"], ["facility", "Facility / plan holder"], ["osro", "OSRO"], ["both", "Both"]] }) +
        '</div><div>' + fld("dpx.osro_names", "OSRO name(s)") + '</div></div>' +
        '<div class="dsec">Equipment quantities</div>' +
        [["personnel", "Support personnel"], ["boom", "Boom (≥1,000 ft or plan total)"], ["skimmer", "Skimmer / recovery (≥1)"], ["other", "Other equipment"]].map(function (r) {
          return '<div class="eqrow"><span>' + esc(r[1]) + '</span>' + fld("dpx.equipment." + r[0] + ".0", "", { cls: "amt", ph: "amount" }) +
            fld("dpx.equipment." + r[0] + ".1", "", { ph: "by owner: OSRO / BNSF / other" }) + '</div>';
        }).join("") + fld("dpx.equipment.alt", "Alternative strategy equipment (in lieu of boom)") +
        '<div class="dsec">Equipment / personnel questions</div>' +
        prp.eq.map(function (q, i) {
          return '<div class="pcard"><div class="pname">' + esc(q[1]) + '</div>' +
            fld("dpx.questions." + i + ".yes", "", { opts: [["true", "Yes"], ["false", "No (describe why not)"]] }) +
            fld("dpx.questions." + i + ".note", "", { area: true, rows: 2, tagOnly: true }) + '</div>';
        }).join(""), true);
      if (isT) html += sec("TTX — summary (Table 3)",
        fld("ttx.location", "Location of table-top") +
        '<div class="g2"><div>' + fld("ttx.start", "Time started", { ph: "0800" }) + '</div><div>' + fld("ttx.end", "Time completed", { ph: "1200" }) + '</div></div>' +
        '<div class="g3"><div>' + fld("ttx.scenario_type", "Scenario", { opts: [["", "—"], ["small", "Small / AMPD"], ["medium", "Medium / MMPD"], ["wcd", "Worst case"]] }) +
        '</div><div>' + fld("ttx.size", "Size") + '</div><div>' + fld("ttx.units", "Units", { opts: [["", "—"], ["bbls", "bbls"], ["gals", "gals"]] }) + '</div></div>' +
        fld("ttx.narrative", "Scenario narrative", { area: true, rows: 5 }), true);
      html += sec("Evaluation — conditions & evaluators",
        fld("eval.conditions", "Conditions of the day (weather, current, river flow)", { area: true, rows: 2 }) +
        (f.gauge && f.gauge.others && f.gauge.others.length ? '<div class="why">Gauge used: ' + esc(f.gauge.name) + ' (' + esc(f.gauge.cfs) + ' cfs). Others nearby: ' +
          f.gauge.others.map(function (g) { return esc(g.name) + " " + esc(g.cfs) + " cfs"; }).join("; ") + '</div>' : '') +
        '<div class="g2"><div>' + fld("eval.environment", "Operating environment", { opts: [["inland", "Inland rivers or canals"], ["great_lakes", "Great Lakes"], ["ocean", "Ocean"], ["other", "Other"]] }) +
        '</div><div>' + fld("eval.environment_other", "Other (specify)") + '</div></div>' +
        fld("eval.scenario", "Scenario (size / threat to water)", { area: true, rows: 3 }) +
        '<div class="dsec">Evaluators (max 3)</div>' + [0, 1, 2].map(function (i) {
          return '<div class="g4">' + fld("eval.evaluators." + i + ".name", "", { ph: "Name" }) + fld("eval.evaluators." + i + ".type", "", { ph: "TTX/DPX" }) +
            fld("eval.evaluators." + i + ".date", "", { ph: "Date" }) + fld("eval.evaluators." + i + ".affiliation", "", { ph: "Affiliation" }) + '</div>';
        }).join(""));
      html += sec("Core components (15)", '<div class="why">Status = was it exercised. The page-1 grid and the 8-1…8-15 boxes tick every component marked Observed or Exercised-not-observed.</div>' +
        d.components.map(function (c, i) { return item("components." + i, "components." + c.key, (i + 1) + ". " + prepName(c.key), prp.why[c.key]); }).join(""), true);
      if (isT) html += sec("TTX objectives A–I",
        '<label class="irow"><input type="checkbox" data-ppb="ttx_obj.applicable"' + (d.ttx_obj.applicable ? " checked" : "") + '><span>TTX objectives applicable</span></label>' +
        prp.ttx.map(function (o) { return item("ttx_obj.items." + o[0], "ttx_obj." + o[0], o[0] + ": " + o[1]); }).join("") +
        fld("ttx_obj.wcd", "I: WCD scenario simulated?", { opts: [["na", "N/A"], ["yes", "Yes"], ["no", "No"]] }));
      if (isD) html += sec("DPX objectives",
        '<label class="irow"><input type="checkbox" data-ppb="frp_obj.applicable"' + (d.frp_obj.applicable ? " checked" : "") + '><span>DPX FRP objectives applicable</span></label>' +
        prp.frp.map(function (o) { return item("frp_obj.items." + o[0], "frp_obj." + o[0], "FRP " + o[0] + ": " + o[1]); }).join("") +
        '<label class="irow"><input type="checkbox" data-ppb="dpx_obj.applicable"' + (d.dpx_obj.applicable ? " checked" : "") + '><span>DPX PREP objectives applicable</span></label>' +
        prp.dpx.map(function (o) { return item("dpx_obj.items." + o[0], "dpx_obj." + o[0], "PREP " + o[0] + ": " + o[1]); }).join(""));
      html += sec("Evaluator / hot wash notes",
        '<div class="why">Type the evaluators’ observations and the hot wash here, Save, then Rebuild this day in the Incident Admin (BNSF drill): the AI redrafts the lines it wrote that you have not edited.</div>' +
        '<textarea class="narr" rows="6" data-note="hotwash">' + esc(prp.notes.hotwash || "") + '</textarea>');
      html += sec("Exercise timeline (Attachment C) — " + prp.doc.timeline.length + " rows",
        '<div class="why">Built from drone flights, check-ins, the ICS 201 and Drill Eval entries. Where times differ, use the photo / drone timestamps. Tick Scenario for simulated (exercise-play) times. Printed as Date · Time · Type · Event.</div>' +
        '<div id="tlRows"></div><button type="button" class="xpand" id="tlAdd">+ add row</button>');
      html += sec("Notifications log (Attachment C) — " + prp.doc.notifications.length,
        '<div class="why">Every notification with its time, who made it and the case / ticket number received (the reviewers require both).</div>' +
        '<div id="nfRows"></div><button type="button" class="xpand" id="nfAdd">+ add notification</button>');
      html += sec("Documents to attach (PDF)",
        '<div class="why">Scans and forms that are not in the apps: the SID ticket, the Ecology form, a printed 207. Each goes where you choose.</div>' +
        '<div id="upList"></div><input type="file" id="upPdf" accept="application/pdf" hidden>' +
        '<button type="button" class="xpand" id="upAdd">+ attach a PDF</button> <span class="ct" id="upMsg"></span>');
      html += sec("After-action report",
        fld("aar.well", "What went well", { area: true, rows: 3 }) + fld("aar.improve", "Areas for improvement", { area: true, rows: 3 }) +
        fld("aar.design", "Design, execution or other comments", { area: true, rows: 3 }) +
        '<div class="dsec">Improvement plan' + aiTag("aar.actions") + '</div>' + [0, 1, 2, 3, 4, 5].map(function (i) {
          return '<div class="g3a">' + fld("aar.actions." + i + ".action", "", { ph: "Action", mk: "aar.actions" }) + fld("aar.actions." + i + ".schedule", "", { ph: "Schedule", mk: "aar.actions" }) +
            fld("aar.actions." + i + ".who", "", { ph: "Responsible", mk: "aar.actions" }) + '</div>';
        }).join("") +
        [["well", "Table 6 — three aspects that went well", 3], ["improve", "Table 6 — three areas of improvement", 3],
         ["design", "Table 6 — design & execution comments", 4], ["general", "Table 6 — general comments", 4]].map(function (r) {
          var xs = []; for (var i = 0; i < r[2]; i++) xs.push(fld("table6." + r[0] + "." + i, "", { mk: "table6." + r[0], ph: (i + 1) + "." }));
          return '<div class="dsec">' + esc(r[1]) + aiTag("table6." + r[0]) + '</div>' + xs.join("");
        }).join(""));
      html += sec("Photo log (12)", '<div class="why">The first 12 ticked photos (Photos list below), in this order. Untick a photo there to drop it.</div><div id="photoLog"></div>');
      html += sec("Sign-in (Table 7) — " + (d.signin.rows || []).length + " people",
        fld("signin.title", "Exercise type and name") + '<div class="g2"><div>' + fld("signin.date", "Date") + '</div><div>' + fld("signin.location", "Location") + '</div></div>' +
        fld("signin.instructor", "Instructor name") +
        '<div class="why">From check-in (State when the person gave it). Rows past 24 go on continuation pages.</div><div id="signinRows"></div>' +
        '<button type="button" class="xpand" id="siAdd">+ add person</button>');
      html += '</div>';
      $("prepPanels").className = "";
      $("prepPanels").innerHTML = html;
      bindPrep($("prepPanels"));
      renderSignin();
      renderPhotoLog();
      renderNoteGroups();
      renderTimeline();
      renderNotifs();
      renderUploads();
      $("tlAdd").onclick = function () { prp.doc.timeline.push({ date: (prp.doc.timeline[0] || {}).date || "", time: "", type: "Operations", event: "", scenario: false }); prp.edited.timeline = true; renderTimeline(); };
      $("nfAdd").onclick = function () { prp.doc.notifications.push({ time: "", notified: "", method: "", by: "", ref: "" }); prp.edited.notifications = true; renderNotifs(); };
      $("upAdd").onclick = function () { $("upPdf").click(); };
      $("upPdf").onchange = function () { uploadPdf(this.files[0]); this.value = ""; };
      $("snInc").onchange = function () { prp.doc.site_notes.include = this.checked; };
      $("snAdd").onclick = function () { (prp.doc.site_notes.groups = prp.doc.site_notes.groups || []).push({ heading: "", bullets: "" }); prp.edited["site_notes.groups"] = true; renderNoteGroups(); };
      $("siAdd").onclick = function () { (prp.doc.signin.rows = prp.doc.signin.rows || []).push({ name: "", title: "", company: "", state: "", email: "", ttx: isT, dpx: isD }); renderSignin(); };
    }
    function bindPrep(root) {
      root.querySelectorAll("[data-pp]").forEach(function (inp) {
        inp.oninput = inp.onchange = function () {
          var path = inp.dataset.pp, v = inp.value;
          if (/\.yes$/.test(path)) v = v === "true";
          setP(path, v);
          prp.edited[inp.dataset.mk] = true;
          $("prepPanels").querySelectorAll(sel("data-aitag", inp.dataset.mk)).forEach(function (n) { n.remove(); });
          if (path === "type") renderPrep();
        };
      });
      root.querySelectorAll("[data-ppb]").forEach(function (cb) { cb.onchange = function () { setP(cb.dataset.ppb, cb.checked); }; });
      root.querySelectorAll("[data-pst]").forEach(function (box) {
        box.querySelectorAll("button.pill").forEach(function (b) {
          b.onclick = function () {
            var on = b.classList.contains("on");
            setP(box.dataset.pst, on ? "" : b.dataset.v);
            prp.edited[box.dataset.mk] = true;
            box.querySelectorAll("button.pill").forEach(function (x) { x.classList.toggle("on", !on && x === b); });
            var tag = box.querySelector(".ai"); if (tag) tag.remove();
          };
        });
      });
      root.querySelectorAll("textarea[data-note]").forEach(function (ta) { ta.oninput = function () { prp.notes[ta.dataset.note] = ta.value; }; });
    }
    function renderTimeline() {
      var rows = prp.doc.timeline;
      rows.sort(function (a, b) { return String((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || "")); });
      $("tlRows").innerHTML = rows.map(function (r, i) {
        var b = "timeline." + i + ".";
        return '<div class="sirow"><span class="ct">' + (i + 1) + '</span>' + fld(b + "time", "", { ph: "HH:MM", cls: "st", mk: "timeline" }) +
          fld(b + "type", "", { ph: "Type", mk: "timeline" }) + fld(b + "event", "", { ph: "Event", mk: "timeline" }) +
          '<label class="irow" title="Simulated (exercise-play) time"><input type="checkbox" data-tls="' + i + '"' + (r.scenario ? " checked" : "") + '><span>Scenario</span></label>' +
          '<button type="button" class="rm" data-tlrm="' + i + '" title="Remove">×</button></div>';
      }).join("") || '<div class="hint">No timeline rows yet.</div>';
      bindPrep($("tlRows"));
      $("tlRows").querySelectorAll("[data-tls]").forEach(function (cb) { cb.onchange = function () { rows[+cb.dataset.tls].scenario = cb.checked; prp.edited.timeline = true; }; });
      $("tlRows").querySelectorAll("[data-tlrm]").forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.tlrm, 1); prp.edited.timeline = true; renderTimeline(); }; });
    }
    function renderNotifs() {
      var rows = prp.doc.notifications;
      $("nfRows").innerHTML = rows.map(function (r, i) {
        var b = "notifications." + i + ".";
        return '<div class="sirow"><span class="ct">' + (i + 1) + '</span>' + fld(b + "time", "", { ph: "HH:MM", cls: "st", mk: "notifications" }) +
          fld(b + "notified", "", { ph: "Notified (agency / person)", mk: "notifications" }) + fld(b + "method", "", { ph: "Method / contact", mk: "notifications" }) +
          fld(b + "by", "", { ph: "Made by", mk: "notifications" }) + fld(b + "ref", "", { ph: "Case / ticket #", mk: "notifications" }) +
          '<button type="button" class="rm" data-nfrm="' + i + '" title="Remove">×</button></div>';
      }).join("") || '<div class="hint">No notifications yet.</div>';
      bindPrep($("nfRows"));
      $("nfRows").querySelectorAll("[data-nfrm]").forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.nfrm, 1); prp.edited.notifications = true; renderNotifs(); }; });
    }
    var PLACES = [["notifications", "After the Notifications Log"], ["ics", "After the ICS 201"], ["signin", "Attachment B (after the sign-in)"], ["end", "End of Attachment C"]];
    function renderUploads() {
      $("upList").innerHTML = prp.attach.map(function (a, i) {
        return '<div class="addrow"><div class="addmeta"><input type="text" class="cap" data-upt="' + i + '" value="' + esc(a.title || a.name || "") + '" placeholder="Title in the package">' +
          '<select class="pin" data-upp="' + i + '">' + PLACES.map(function (p) { return '<option value="' + p[0] + '"' + (a.place === p[0] ? " selected" : "") + '>' + esc(p[1]) + '</option>'; }).join("") + '</select></div>' +
          '<button type="button" class="rm" data-uprm="' + i + '" title="Remove">×</button></div>';
      }).join("");
      $("upList").querySelectorAll("[data-upt]").forEach(function (inp) { inp.oninput = function () { prp.attach[+inp.dataset.upt].title = inp.value; }; });
      $("upList").querySelectorAll("[data-upp]").forEach(function (s) { s.onchange = function () { prp.attach[+s.dataset.upp].place = s.value; }; });
      $("upList").querySelectorAll("[data-uprm]").forEach(function (b) { b.onclick = function () { prp.attach.splice(+b.dataset.uprm, 1); renderUploads(); }; });
    }
    function uploadPdf(f) {
      if (!f) return;
      if (f.type !== "application/pdf") { $("upMsg").textContent = "PDF files only."; return; }
      if (f.size > MAX_UPLOAD) { $("upMsg").textContent = "Over 10 MB."; return; }
      var btn = $("upAdd"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Uploading…'; $("upMsg").textContent = "";
      var rd = new FileReader();
      rd.onload = function () {
        api("package-upload", { name: f.name, mime: "application/pdf", data_b64: String(rd.result).split(",")[1] })
          .then(function (j) {
            if (!j || !j.ok) throw new Error((j && j.error) || "upload failed");
            prp.attach.push({ file_id: j.file_id, name: f.name, title: f.name.replace(/\.pdf$/i, ""), place: /sid|notif|nrc/i.test(f.name) ? "notifications" : "end" });
            renderUploads(); $("upMsg").textContent = "Attached — Save to keep it.";
          })
          .catch(function (e) { $("upMsg").textContent = "Upload failed: " + e.message; })
          .then(function () { btn.disabled = false; btn.textContent = "+ attach a PDF"; });
      };
      rd.readAsDataURL(f);
    }
    function renderNoteGroups() {
      var gs = prp.doc.site_notes.groups || [];
      gs.forEach(function (g) { if (Array.isArray(g.bullets)) g.bullets = g.bullets.join("\n"); });
      $("snGroups").innerHTML = gs.length ? gs.map(function (g, i) {
        var b = "site_notes.groups." + i + ".";
        return '<div class="pcard">' + fld(b + "heading", "", { ph: "Heading, e.g. Equipment / Training and Awareness", mk: "site_notes.groups" }) +
          fld(b + "bullets", "", { area: true, rows: 3, mk: "site_notes.groups" }) +
          '<button type="button" class="rm" data-snrm="' + i + '" title="Remove group">× remove group</button></div>';
      }).join("") : '<div class="hint">No groups yet: add one, or type the hot wash under “Evaluator / hot wash notes”, Save and Rebuild to get an AI draft.</div>';
      bindPrep($("snGroups"));
      $("snGroups").querySelectorAll("[data-snrm]").forEach(function (b) {
        b.onclick = function () { gs.splice(+b.dataset.snrm, 1); prp.edited["site_notes.groups"] = true; renderNoteGroups(); };
      });
    }
    function renderSignin() {
      var rows = prp.doc.signin.rows || [];
      $("signinRows").innerHTML = rows.map(function (r, i) {
        var b = "signin.rows." + i + ".";
        return '<div class="sirow"><span class="ct">' + (i + 1) + '</span>' + fld(b + "name", "", { ph: "Name" }) + fld(b + "title", "", { ph: "Title" }) +
          fld(b + "company", "", { ph: "Company" }) + fld(b + "state", "", { ph: "ST", cls: "st" }) + fld(b + "email", "", { ph: "Email" }) +
          '<button type="button" class="rm" data-sirm="' + i + '" title="Remove">×</button></div>';
      }).join("");
      bindPrep($("signinRows"));
      $("signinRows").querySelectorAll("[data-sirm]").forEach(function (b) { b.onclick = function () { rows.splice(+b.dataset.sirm, 1); renderSignin(); }; });
    }
    function logPhotos() {
      var ids = photos.filter(function (ph) { return !state.exclude.photos[ph.id]; }).map(function (ph) { return ph.id; });
      var order = prp.photo_order.filter(function (k) { return ids.indexOf(k) >= 0; });
      ids.forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
      prp.photo_order = order;
      return order.map(function (k) { return photos.find(function (ph) { return ph.id === k; }); });
    }
    function renderPhotoLog() {
      var box = $("photoLog"); if (!box) return;
      var list = logPhotos();
      box.innerHTML = list.length ? list.map(function (ph, i) {
        var cap = prp.captions[ph.id] != null ? prp.captions[ph.id] : (ph.p.type || "");
        return '<div class="addrow' + (i >= 12 ? ' off' : '') + '"><img src="' + esc(ph.p.thumb || ph.p.src) + '" alt=""><div class="addmeta"><div>' +
          (i < 12 ? (i + 1) + '.' : 'not in the log') + '</div><input type="text" class="cap" data-capk="' + esc(ph.id) + '" value="' + esc(cap) + '" placeholder="Caption"></div>' +
          '<button class="rm" data-mv="' + i + '" data-d="-1" title="Move up">↑</button><button class="rm" data-mv="' + i + '" data-d="1" title="Move down">↓</button></div>';
      }).join("") : '<div class="hint">No photos for this day. Add photos below (Add photos), Save, and Rebuild.</div>';
      box.querySelectorAll("input[data-capk]").forEach(function (inp) { inp.oninput = function () { prp.captions[inp.dataset.capk] = inp.value; }; });
      box.querySelectorAll("[data-mv]").forEach(function (b) {
        b.onclick = function () {
          var i = +b.dataset.mv, j = i + (+b.dataset.d), o = prp.photo_order;
          if (j < 0 || j >= o.length) return;
          var x = o[i]; o[i] = o[j]; o[j] = x; renderPhotoLog();
        };
      });
    }

    function busy(b) { $("curSave").disabled = b; $("curPublish").disabled = b; }
    function pendingUploads() { return state.added.some(function (a) { return !a.file_id && /uploading/.test(a.status); }); }

    $("curSave").onclick = function () {
      if (pendingUploads()) { msg("Wait for the photo uploads to finish.", true); return; }
      busy(true); msg("Saving…");
      api("package-curate", { curation_json: JSON.stringify(fullCuration()) })
        .then(function (j) { msg(j && j.ok ? "Saved." : "Save failed: " + ((j && j.error) || "unknown"), !(j && j.ok)); })
        .catch(function (e) { msg("Save failed: " + e.message, true); })
        .then(function () { busy(false); });
    };
    $("curPublish").onclick = function () {
      if (pendingUploads()) { msg("Wait for the photo uploads to finish.", true); return; }
      var c = fullCuration();
      if (isDaily && dly) {
        var un = Object.keys(dly.narrative).filter(function (k) { return !dly.edited[k] && (dly.narrative[k] || "").trim(); });
        if (un.length && !confirm("These narrative sections have not been reviewed/edited: " + un.join(", ") + ".\n\nPublish anyway?")) return;
      }
      if (isPrep && prp) {
        var open_ = prp.doc.components.filter(function (x) { return !x.status; }).map(function (x) { return prepName(x.key); });
        var ai = Object.keys(prp.marks).filter(function (k) { return prp.marks[k] === "ai" && !prp.edited[k]; }).length;
        if ((open_.length || ai) && !confirm((open_.length ? "No status yet for: " + open_.join(", ") + ".\n" : "") +
            (ai ? ai + " AI-written field(s) not reviewed/edited yet.\n" : "") + "\nPublish anyway?")) return;
      }
      if (!c.recipients.length && !confirm("No one is selected to receive the email. Publish anyway?")) return;
      if (!confirm((isPrep ? "Publish the BNSF drill package?\n\nThe filled form + attachments are built and " :
                   "Publish this package with the current selection?\n\nThe public page goes live and ") +
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
