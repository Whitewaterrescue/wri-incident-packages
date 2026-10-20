/* ?edit=1 curation editor. A right-rail over the SAME rendered draft (WYSIWYG) reached from the
   Field App's "Review draft". Controls:
     - per-SECTION include/exclude (Summary / Map / 360 / Orthos / Photos / ...)
     - per-ITEM include/exclude for Orthos, 360s and Photos (pick exactly which ones ship)
     - ADD IMAGES that aren't on the map (loose photos/diagrams) -> appended to the gallery
   Selections preview live. "Publish" hands the selection (curation_json) + any added images to the
   builder, which re-emits the public package + PDF honoring it.

   NOTE: in this local prototype the preview + selection are fully live; the server round-trip
   (persist curation_json, upload added images, re-publish) is the production wiring step. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  window.initCuration = function (data) {
    document.body.classList.add("editing");
    var sections = (data.manifest && data.manifest.sections) || [];
    var state = Object.assign({ summary: true, map: true, panos: true, orthos: true, photos: true }, data.sections || {});
    var excluded = { orthos: {}, panos: {}, photos: {} };   // id -> true when turned OFF
    var added = [];                                          // {name, url}

    // per-item lists come from the rendered data
    var itemSets = {
      orthos: (data.orthos || []).map(function (o) { return { id: String(o.id), label: o.name || "Ortho", sel: "[data-ortho='" + cssesc(o.id) + "']" }; }),
      panos: (data.panos || []).map(function (p) { return { id: String(p.id), label: (p.name || "Panorama") + (p.site_label ? " · " + p.site_label : ""), sel: "[data-pano='" + cssesc(p.id) + "']" }; }),
      photos: (data.photos || []).map(function (p, i) { return { id: String(i), label: (p.type || "Photo") + " " + (i + 1), sel: "[data-photo='" + i + "']" }; }),
    };
    function cssesc(s) { return String(s).replace(/'/g, "\\'"); }

    var el = document.createElement("aside");
    el.id = "curate";
    el.innerHTML =
      '<header>Edit package</header>' +
      '<div class="body">' +
        '<div class="hint">Choose what appears in the shared package, then Publish. Contact details are kept out of the public page automatically.</div>' +
        sections.map(function (s) {
          var hasItems = itemSets[s.key] && itemSets[s.key].length;
          return '<div class="csec">' +
            '<label class="crow"><input type="checkbox" data-sec="' + esc(s.key) + '"' + (state[s.key] !== false ? ' checked' : '') + '>' +
            '<span class="lbl">' + esc(s.label) + '</span>' + (s.count != null ? '<span class="ct">' + esc(s.count) + '</span>' : '') +
            (hasItems ? '<button class="xpand" data-xp="' + esc(s.key) + '">items</button>' : '') + '</label>' +
            (hasItems ? '<div class="items" id="items-' + esc(s.key) + '" hidden>' +
              itemSets[s.key].map(function (it) {
                return '<label class="irow"><input type="checkbox" data-item="' + esc(s.key) + '" data-id="' + esc(it.id) + '" checked>' +
                  '<span>' + esc(it.label) + '</span></label>'; }).join('') +
            '</div>' : '') + '</div>';
        }).join("") +
        '<div class="csec add"><div class="lbl" style="font-weight:600;margin-bottom:6px">Add images</div>' +
          '<div class="hint" style="margin:0 0 6px">Photos or diagrams that aren’t on the map — they’ll appear in the Photos gallery.</div>' +
          '<label class="drop" id="drop"><input type="file" id="addfiles" accept="image/*" multiple hidden>+ Choose images</label>' +
          '<div id="addedlist"></div>' +
        '</div>' +
      '</div>' +
      '<footer><button class="btn" id="curSave">Save</button><button class="btn primary" id="curPublish">Publish</button></footer>';
    document.body.appendChild(el);

    // section toggles
    el.querySelectorAll("input[data-sec]").forEach(function (cb) {
      cb.onchange = function () {
        state[cb.dataset.sec] = cb.checked;
        var sec = $("sec-" + cb.dataset.sec);
        if (sec) sec.style.opacity = cb.checked ? "" : ".35";
      };
      cb.onchange();
    });
    // expand/collapse item lists
    el.querySelectorAll(".xpand").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); var box = $("items-" + b.dataset.xp); if (box) box.hidden = !box.hidden; };
    });
    // per-item toggles -> live hide/show the card
    el.querySelectorAll("input[data-item]").forEach(function (cb) {
      cb.onchange = function () {
        var set = itemSets[cb.dataset.item].find(function (x) { return x.id === cb.dataset.id; });
        if (!set) return;
        excluded[cb.dataset.item][cb.dataset.id] = !cb.checked;
        document.querySelectorAll(set.sel).forEach(function (node) { node.style.display = cb.checked ? "" : "none"; });
      };
    });

    // add images (local preview via object URLs)
    function addFiles(files) {
      Array.prototype.forEach.call(files, function (f) {
        if (!/^image\//.test(f.type)) return;
        var url = URL.createObjectURL(f);
        added.push({ name: f.name, url: url });
        var g = $("gallery");
        if (g) {
          var fig = document.createElement("figure");
          fig.className = "shot added";
          fig.innerHTML = '<img src="' + url + '" alt="' + esc(f.name) + '"><figcaption>Added · ' + esc(f.name) + '</figcaption><button class="rm" title="Remove">×</button>';
          fig.querySelector(".rm").onclick = function () { fig.remove(); added = added.filter(function (a) { return a.url !== url; }); renderAdded(); };
          g.appendChild(fig);
        }
        renderAdded();
      });
    }
    function renderAdded() {
      $("addedlist").innerHTML = added.length ? added.map(function (a) { return '<div class="addrow">✓ ' + esc(a.name) + '</div>'; }).join("") : '';
      // make sure the Photos section is on if images were added
      if (added.length) { var pc = el.querySelector("input[data-sec='photos']"); if (pc && !pc.checked) { pc.checked = true; pc.onchange(); } }
    }
    $("drop").onclick = function () { $("addfiles").click(); };
    $("addfiles").onchange = function () { addFiles(this.files); this.value = ""; };
    el.querySelector("#drop").addEventListener("dragover", function (e) { e.preventDefault(); el.querySelector("#drop").classList.add("over"); });
    el.querySelector("#drop").addEventListener("dragleave", function () { el.querySelector("#drop").classList.remove("over"); });
    el.querySelector("#drop").addEventListener("drop", function (e) { e.preventDefault(); el.querySelector("#drop").classList.remove("over"); addFiles(e.dataTransfer.files); });

    function curationJson() {
      return {
        version: 1, sections: state,
        items: {
          orthos: Object.keys(excluded.orthos).filter(function (k) { return excluded.orthos[k]; }),
          panos: Object.keys(excluded.panos).filter(function (k) { return excluded.panos[k]; }),
          photos: Object.keys(excluded.photos).filter(function (k) { return excluded.photos[k]; }),
        },
        added_images: added.map(function (a) { return a.name; }),
      };
    }

    $("curSave").onclick = function () {
      var j = curationJson();
      console.log("curation_json", j);
      alert("Selection captured:\n\n" + JSON.stringify(j, null, 1) +
        (added.length ? "\n\n(" + added.length + " added image(s) — these upload with the package on Publish in production.)" : "") +
        "\n\n[Prototype] In production this saves to the request and re-renders.");
    };
    $("curPublish").onclick = function () {
      if (!confirm("Publish this package publicly with the current selection?")) return;
      alert("[Prototype] Publish would: upload " + added.length + " added image(s), save the selection, and re-render the public package + briefing PDF honoring it.");
    };
  };
})();
