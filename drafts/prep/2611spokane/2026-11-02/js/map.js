/* Leaflet map for the frozen package. Reads the baked data/recon.geojson (no AGOL, no login) and
   draws recon points with photo popups. Esri World Imagery basemap tiles are anonymously
   consumable, so the published microsite needs no token. window.initPackageMap(data) is called
   by index.html once the section is shown. */
(function () {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  // category -> dot colour (Safety is excluded by the public view, but keep a colour in case a
  // private-layer package ever includes it)
  var CAT_COLORS = {
    "Response Actions": "#EC2329", "Observations": "#f39c12", "Safety": "#e74c3c", "": "#9ec5ff"
  };

  function dot(color) {
    return L.divIcon({
      className: "pk-dot",
      html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:' + color +
            ';border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.5)"></span>',
      iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -9]
    });
  }

  function fmtDate(v) {
    var n = Number(v);
    var d = isFinite(n) && n > 1e11 ? new Date(n) : new Date(v);
    return isNaN(d) ? String(v || "") : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function popupHtml(p) {
    var title = p.observation_type || p.observation_category || "Recon";
    var html = '<div class="pk-pop"><h4>' + esc(title) + '</h4>';
    if (p.observation_datetime) html += '<div class="k">' + esc(fmtDate(p.observation_datetime)) + '</div>';
    if (p.observation_subtype) html += '<div>' + esc(p.observation_subtype) + '</div>';
    if (p.description) html += '<p style="margin-top:6px">' + esc(p.description) + '</p>';
    (p._photos || []).forEach(function (src) {
      html += '<img src="' + esc(src) + '" alt="recon photo" loading="lazy">';
    });
    return html + '</div>';
  }

  function panoPopup(p) {
    return '<div class="pk-pop"><h4>360° ' + esc(p.name || "") + '</h4>' +
      (p.site_label ? '<div class="k">' + esc(p.site_label) + '</div>' : '') +
      '<p style="margin-top:6px"><a href="' + esc(p.viewer_url) + '" target="_blank" rel="noopener">Open 360° viewer →</a></p></div>';
  }

  window.initPackageMap = function (data) {
    if (window.__wriMap) { window.__wriMap.invalidateSize(); return; }
    var el = document.getElementById("map");
    if (!el) return;
    var map = L.map(el, { scrollWheelZoom: true });
    window.__wriMap = map;
    var base = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery &copy; Esri" }
    ).addTo(map);

    var overlays = {};                 // layer-control toggles
    var allBounds = L.latLngBounds([]);
    var pending = 0, fitted = false;
    function extend(b) { if (b && b.isValid()) allBounds.extend(b); }
    function fit() {
      if (fitted) return; fitted = true;
      if (allBounds.isValid()) map.fitBounds(allBounds.pad(0.2));
      else if (data.map && data.map.center) map.setView(data.map.center, 12);
      else map.setView([44.5, -110], 6);
      if (Object.keys(overlays).length) L.control.layers(null, overlays, { collapsed: false }).addTo(map);
    }
    function load(url, cb) {
      if (!url) return;
      pending++;
      fetch(url, { cache: "no-store" }).then(function (r) { return r.json(); })
        .then(cb).catch(function () {}).then(function () { if (--pending <= 0) fit(); });
    }

    // orthos UNDER the points
    load(data.map && data.map.orthos_url, function (list) {
      (list || []).forEach(function (o) {
        if (!o.bounds) return;
        var s = o.bounds[0], w = o.bounds[1], n = o.bounds[2], e = o.bounds[3];
        var ov = L.imageOverlay(o.png, [[s, w], [n, e]], { opacity: 0.9 }).addTo(map);
        overlays[(o.name || "Ortho")] = ov;
        extend(L.latLngBounds([[s, w], [n, e]]));
      });
    });

    // recon points
    load((data.map && data.map.recon_url) || "data/recon.geojson", function (fc) {
      if (!fc || !(fc.features || []).length) return;
      var layer = L.geoJSON(fc, {
        pointToLayer: function (f, latlng) {
          var cat = (f.properties && f.properties.observation_category) || "";
          return L.marker(latlng, { icon: dot(CAT_COLORS[cat] || CAT_COLORS[""]) });
        },
        onEachFeature: function (f, lyr) { lyr.bindPopup(popupHtml(f.properties || {}), { maxWidth: 300 }); }
      }).addTo(map);
      overlays["Recon points"] = layer;
      extend(layer.getBounds());
    });

    // pano markers (cyan dots -> open the sphere)
    load(data.map && data.map.panos_url, function (fc) {
      var pts = (fc && fc.features || []).filter(function (f) { return f.geometry; });
      if (!pts.length) return;
      var layer = L.geoJSON({ type: "FeatureCollection", features: pts }, {
        pointToLayer: function (f, latlng) { return L.marker(latlng, { icon: dot("#00bcd4") }); },
        onEachFeature: function (f, lyr) { lyr.bindPopup(panoPopup(f.properties || {}), { maxWidth: 260 }); }
      }).addTo(map);
      overlays["360° panoramas"] = layer;
      extend(layer.getBounds());
    });

    // if nothing had geometry, still settle the view
    setTimeout(function () { if (pending <= 0) fit(); }, 50);
  };
})();
