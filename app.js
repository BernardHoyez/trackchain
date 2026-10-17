'use strict';
const VERSION = 'v1';          // à garder aligné avec CACHE_NAME dans sw.js
const MAX = 5, COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
let traces = [], preview = null, undo = null, seq = 0, dirHandle = null;
const FSA = 'showDirectoryPicker' in window;
$('ver').textContent = VERSION;

/* ---------- Carte ---------- */
const ign = (layer, set, fmt) => L.tileLayer(
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer +
  '&STYLE=normal&FORMAT=' + fmt + '&TILEMATRIXSET=' + set + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  { maxNativeZoom: 19, maxZoom: 20, attribution: '© IGN' });
const bases = {
  'OSM': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 20, attribution: '© OpenStreetMap' }),
  'IGN Plan v2': ign('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'PM', 'image/png'),
  'IGN BD Ortho': ign('ORTHOIMAGERY.ORTHOPHOTOS', 'PM_0_19', 'image/jpeg')
};
const map = L.map('map').setView([46.6, 2.5], 6);
let lastBase = null; try { lastBase = localStorage.getItem('tc-base'); } catch (e) { }
(bases[lastBase] || bases['OSM']).addTo(map);
L.control.layers(bases, null, { collapsed: true }).addTo(map);
map.on('baselayerchange', (e) => { try { localStorage.setItem('tc-base', e.name); } catch (_) { } });
const gTr = L.layerGroup().addTo(map), gPv = L.layerGroup().addTo(map);

/* ---------- Géométrie ---------- */
const R = 6371000, rad = Math.PI / 180;
const dist = (a, b) => {
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const bearing = (a, b) => {
  const dl = (b.lon - a.lon) * rad, p1 = a.lat * rad, p2 = b.lat * rad;
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / rad;
};
const len = (pts) => pts.reduce((s, p, i) => s + (i ? dist(pts[i - 1], p) : 0), 0);
const fmt = (m) => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
const ll = (p) => [p.lat, p.lon];

/* ---------- Lecture GPX / KML / KMZ (horodatages ignorés) ---------- */
const num = (v) => { v = parseFloat(v); return isFinite(v) ? v : undefined; };
const tags = (n, name) => Array.from(n.getElementsByTagNameNS('*', name));
function parseGPX(doc) {
  let els = tags(doc, 'trkpt');
  if (!els.length) els = tags(doc, 'rtept');
  if (!els.length) els = tags(doc, 'wpt');
  return els.map((e) => ({ lat: num(e.getAttribute('lat')), lon: num(e.getAttribute('lon')), ele: num((tags(e, 'ele')[0] || {}).textContent) }));
}
function parseKML(doc) {
  const pts = [], add = (a) => { if (isFinite(a[0]) && isFinite(a[1])) pts.push({ lon: a[0], lat: a[1], ele: isFinite(a[2]) ? a[2] : undefined }); };
  tags(doc, 'LineString').forEach((ls) => {
    const c = tags(ls, 'coordinates')[0];
    if (c) c.textContent.trim().split(/\s+/).forEach((s) => add(s.split(',').map(parseFloat)));
  });
  if (!pts.length) tags(doc, 'coord').forEach((c) => add(c.textContent.trim().split(/\s+/).map(parseFloat)));
  return pts;
}
async function readFile(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  let text;
  if (ext === 'kmz') {
    const z = await JSZip.loadAsync(await f.arrayBuffer());
    const k = z.file('doc.kml') || z.file(/\.kml$/i)[0];
    if (!k) throw new Error('aucun KML dans le KMZ');
    text = await k.async('string');
  } else text = await f.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML invalide');
  const pts = (ext === 'gpx' ? parseGPX(doc) : parseKML(doc)).filter((p) => isFinite(p.lat) && isFinite(p.lon));
  if (pts.length < 2) throw new Error('moins de 2 points');
  return pts;
}
$('file').onchange = async (e) => {
  for (const f of e.target.files) {
    if (traces.length >= MAX) { toast('Maximum ' + MAX + ' traces.'); break; }
    try {
      traces.push({ id: ++seq, name: f.name.replace(/\.[^.]+$/, ''), pts: await readFile(f), color: freeColor() });
    } catch (err) { toast(f.name + ' : ' + err.message); }
  }
  e.target.value = '';
  clearPreview(); render(true); refresh();
};
const freeColor = () => COLORS.find((c) => !traces.some((t) => t.color === c)) || COLORS[0];

/* ---------- Affichage ---------- */
function arrows(pts, color) {
  const n = Math.min(8, Math.floor(pts.length / 2));
  for (let i = 1; i <= n; i++) {
    const k = Math.floor(pts.length * i / (n + 1));
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    L.marker(ll(pts[k]), {
      interactive: false,
      icon: L.divIcon({ className: 'arr', iconSize: [15, 15], html: '<span style="color:' + color + ';transform:rotate(' + bearing(a, b).toFixed(0) + 'deg)">▲</span>' })
    }).addTo(gTr);
  }
}
function render(fit) {
  gTr.clearLayers();
  traces.forEach((t) => {
    L.polyline(t.pts.map(ll), { color: t.color, weight: 4, opacity: .9 }).bindTooltip(t.name, { sticky: true }).addTo(gTr);
    arrows(t.pts, t.color);
    const dot = (p, c) => L.circleMarker(ll(p), { radius: 6, color: '#fff', weight: 2, fillColor: c, fillOpacity: 1 }).addTo(gTr);
    dot(t.pts[0], '#2e7d32'); dot(t.pts[t.pts.length - 1], '#c62828');
  });
  if (fit && traces.length) map.fitBounds(L.latLngBounds(traces.flatMap((t) => t.pts.map(ll))), { padding: [30, 30] });
}
function refresh() {
  $('list').innerHTML = traces.map((t) =>
    '<li><i style="background:' + t.color + '"></i><span>' + esc(t.name) + ' <small>' + t.pts.length + ' pts · ' + fmt(len(t.pts)) + '</small></span>' +
    '<button data-a="rev" data-i="' + t.id + '" title="Inverser le sens">⇄</button><button data-a="del" data-i="' + t.id + '" title="Retirer">✕</button></li>'
  ).join('') || '<li class="muted">Aucune trace chargée.</li>';
  const ids = ['selA', 'selB', 'selS'], keep = ids.map((i) => $(i).value);
  const opts = traces.map((t) => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
  ids.forEach((i, k) => { $(i).innerHTML = opts; if (traces.some((t) => t.id == keep[k])) $(i).value = keep[k]; });
  if (traces.length > 1 && $('selA').value === $('selB').value) $('selB').value = traces.find((t) => t.id != $('selA').value).id;
  $('bPrev').disabled = traces.length < 2;
  $('bUndo').hidden = !undo;
}
$('list').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const t = traces.find((x) => x.id == b.dataset.i);
  if (b.dataset.a === 'rev') t.pts.reverse(); else { traces = traces.filter((x) => x !== t); undo = null; }
  clearPreview(); render(); refresh();
};

/* ---------- Jonction ---------- */
const getT = (id) => traces.find((t) => t.id == $(id).value);
const mode = () => document.querySelector('input[name=mode]:checked').value;
document.querySelectorAll('input[name=mode]').forEach((r) => r.onchange = () => { $('ropts').hidden = mode() !== 'route'; clearPreview(); });
$('selA').onchange = $('selB').onchange = clearPreview;
function clearPreview() { preview = null; gPv.clearLayers(); $('bLin').hidden = $('bOk').hidden = true; $('info').textContent = ''; }

async function route(a, b) {
  const q = new URLSearchParams({
    resource: $('res').value, profile: 'pedestrian', optimization: $('opt').value,
    start: a.lon + ',' + a.lat, end: b.lon + ',' + b.lat,
    geometryFormat: 'geojson', getSteps: 'false', getBbox: 'false', crs: 'EPSG:4326', distanceUnit: 'meter'
  });
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('https://data.geopf.fr/navigation/itineraire?' + q, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const c = ((await r.json()).geometry || {}).coordinates;
    if (!Array.isArray(c) || c.length < 2) throw new Error('réponse inattendue');
    return c.map((x) => ({ lon: x[0], lat: x[1] }));
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'délai dépassé' : (e.message === 'Failed to fetch' ? 'réseau injoignable' : e.message));
  } finally { clearTimeout(to); }
}
// Altitudes du segment de jonction : interpolation linéaire selon la distance cumulée
function interp(mid, a, b) {
  if (!mid.length || a.ele === undefined || b.ele === undefined) return mid;
  const path = [a, ...mid, b], cum = [0];
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + dist(path[i - 1], path[i]);
  const tot = cum[cum.length - 1] || 1;
  return mid.map((p, i) => ({ ...p, ele: a.ele + (b.ele - a.ele) * cum[i + 1] / tot }));
}
async function makePreview(forceLin) {
  const A = getT('selA'), B = getT('selB');
  if (!A || !B || A === B) return toast('Choisissez deux traces différentes.');
  const a = A.pts[A.pts.length - 1], b = B.pts[0], gap = dist(a, b);
  let mid = [], msg = '', routed = false;
  if (!forceLin && mode() === 'route') {
    $('info').textContent = 'Calcul de l’itinéraire…';
    try { mid = await route(a, b); routed = true; }
    catch (err) { msg = '⚠ Routage IGN indisponible (' + err.message + ') : jonction linéaire utilisée. '; }
  }
  mid = interp(mid, a, b);
  const jl = len([a, ...mid, b]);
  msg += routed ? 'Itinéraire IGN : ' + fmt(jl) + ' (à vol d’oiseau : ' + fmt(gap) + ')' + (mid[0] && mid[0].ele !== undefined ? ', altitudes interpolées.' : '.')
    : 'Jonction linéaire : ' + fmt(gap) + '.';
  preview = { A, B, mid, routed };
  gPv.clearLayers();
  const line = L.polyline([a, ...mid, b].map(ll), { color: '#ff9800', weight: 6, dashArray: '8 8' }).addTo(gPv);
  map.fitBounds(line.getBounds(), { padding: [50, 50], maxZoom: 17 });
  $('info').textContent = msg; $('bLin').hidden = !routed; $('bOk').hidden = false;
}
$('bPrev').onclick = () => makePreview(false);
$('bLin').onclick = () => makePreview(true);
$('bOk').onclick = () => {
  if (!preview) return;
  const { A, B, mid } = preview, pts = [...A.pts, ...mid, ...B.pts];
  const chain = { id: ++seq, name: A.name + '+' + B.name, pts, color: A.color };
  undo = { removed: [A, B], chain };
  traces = traces.filter((t) => t !== A && t !== B); traces.push(chain);
  clearPreview(); render(true); refresh(); $('selS').value = chain.id;
  toast('Enchaînement créé : ' + fmt(len(pts)));
};
$('bUndo').onclick = () => {
  if (!undo) return;
  traces = traces.filter((t) => t !== undo.chain).concat(undo.removed); undo = null;
  clearPreview(); render(true); refresh();
};

/* ---------- Export ---------- */
const toGPX = (t) => '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="trackchain" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>' + esc(t.name) + '</name><trkseg>\n' +
  t.pts.map((p) => '<trkpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lon.toFixed(7) + '">' + (p.ele !== undefined ? '<ele>' + p.ele.toFixed(1) + '</ele>' : '') + '</trkpt>').join('\n') +
  '\n</trkseg></trk></gpx>\n';
const toKML = (t) => '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + esc(t.name) + '</name><Placemark><name>' + esc(t.name) +
  '</name><Style><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>\n' +
  t.pts.map((p) => p.lon.toFixed(7) + ',' + p.lat.toFixed(7) + ',' + (p.ele !== undefined ? p.ele.toFixed(1) : 0)).join('\n') +
  '\n</coordinates></LineString></Placemark></Document></kml>\n';

const idb = () => new Promise((ok, ko) => { const r = indexedDB.open('trackchain', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
const idbGet = async () => { try { const d = await idb(); return await new Promise((ok) => { const q = d.transaction('kv').objectStore('kv').get('dir'); q.onsuccess = () => ok(q.result); q.onerror = () => ok(); }); } catch (e) { } };
const idbSet = async (h) => { try { (await idb()).transaction('kv', 'readwrite').objectStore('kv').put(h, 'dir'); } catch (e) { } };

const ask = (t) => new Promise((ok) => {
  const d = $('dlg'); $('dlgTxt').textContent = t; d.returnValue = 'no';
  d.onclose = () => ok(d.returnValue === 'ok'); d.showModal();
});
$('dlgOk').onclick = () => $('dlg').close('ok'); $('dlgNo').onclick = () => $('dlg').close('no');

async function getDir(force) {
  if (!dirHandle) dirHandle = await idbGet();
  if (dirHandle && !force) {
    let p = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted') p = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (p === 'granted') return dirHandle;
  }
  if (!await ask('Avant de choisir le dossier : le sous-dossier « chain » doit avoir été créé une fois à la main dans Téléchargements (Downloads/chain). Le navigateur ne peut pas le créer, ni autoriser le dossier Téléchargements lui-même. Sélectionnez ensuite ce dossier « chain ».')) return null;
  try {
    const h = await window.showDirectoryPicker({ id: 'trackchain', mode: 'readwrite', startIn: 'downloads' });
    if (h.name !== 'chain' && !await ask('Le dossier choisi s’appelle « ' + h.name + ' » et non « chain ». L’utiliser quand même ?')) return null;
    dirHandle = h; await idbSet(h); $('saveInfo').textContent = 'Dossier de sauvegarde : ' + h.name + '/';
    return h;
  } catch (e) { if (e.name === 'AbortError') return null; throw e; }
}
function download(name, content, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('bSave').onclick = async () => {
  const t = traces.find((x) => x.id == $('selS').value); if (!t) return toast('Aucune trace à enregistrer.');
  const base = 'chain_' + t.name.replace(/[^\w.\-+]+/g, '_').slice(0, 80), files = [];
  if ($('fGpx').checked) files.push([base + '.gpx', toGPX(t), 'application/gpx+xml']);
  if ($('fKml').checked) files.push([base + '.kml', toKML(t), 'application/vnd.google-earth.kml+xml']);
  if (!files.length) return toast('Cochez GPX et/ou KML.');
  if (FSA) {
    try {
      const dir = await getDir(false);
      if (!dir) return toast('Enregistrement annulé.');
      for (const [n, c] of files) { const w = await (await dir.getFileHandle(n, { create: true })).createWritable(); await w.write(c); await w.close(); }
      $('saveInfo').textContent = 'Enregistré dans ' + dir.name + '/ : ' + files.map((f) => f[0]).join(', ');
      return;
    } catch (e) { toast('Écriture directe impossible (' + e.message + ') : téléchargement classique.'); }
  }
  files.forEach((f, i) => setTimeout(() => download(...f), i * 400));
  $('saveInfo').textContent = 'Téléchargé dans Téléchargements : déplacez le fichier dans chain/ à la main.';
};
if (FSA) { $('bDir').hidden = false; $('bDir').onclick = () => getDir(true).catch((e) => toast(e.message)); }
else $('saveInfo').textContent = 'Ce navigateur ne peut pas écrire dans un dossier : les fichiers iront dans Téléchargements, à déplacer dans chain/ à la main.';

/* ---------- Toast + service worker ---------- */
function toast(msg, reload) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  if (reload) { const b = document.createElement('button'); b.textContent = 'Recharger'; b.onclick = () => location.reload(); t.appendChild(b); }
  clearTimeout(toast.h); if (!reload) toast.h = setTimeout(() => t.hidden = true, 5000);
}
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => { });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('Nouvelle version installée.', true); });
}
refresh();
