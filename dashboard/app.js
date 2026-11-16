// Token Radar dashboard: renders window.RADAR (written by main.ts from the sealed snapshot).
// No network, no framework, no imports: the whole dataset is in data.js beside this page.

const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** $1.23B, $456M, $12.3K, $123. */
function usd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

/** +5.8% / -3.2% / —. */
function pct(x) {
  if (x === null || x === undefined) return '—';
  const sign = x > 0 ? '+' : '';
  return sign + x.toFixed(1) + '%';
}

function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}

function changeClass(x) {
  if (x === null || x === undefined) return '';
  return x > 0 ? 'up' : x < 0 ? 'down' : '';
}

const state = { tab: 'board', q: '', cat: '', chain: '', wlOnly: false, earlyOnly: false, sort: 'value', detail: null };

function sortedRows(rows) {
  const r = [...rows];
  const by = state.sort;
  if (by === 'tvl') r.sort((a, b) => b.tvl_usd - a.tvl_usd);
  else if (by === 'growth') r.sort((a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9));
  else if (by === 'age') r.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));
  else if (by === 'name') r.sort((a, b) => a.name.localeCompare(b.name));
  else r.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  return r;
}

function filteredRows() {
  const q = state.q.trim().toLowerCase();
  return D.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.wlOnly && !r.on_watchlist) return false;
    if (state.earlyOnly && r.on_watchlist) return false;
    return true;
  });
}

function boardRowHtml(r) {
  const wl = r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '';
  return '<tr class="clickable' + (state.detail === r.slug ? ' selected' : '') + '" data-slug="' + esc(r.slug) + '">' +
    '<td class="num">' + r.rank + '</td>' +
    '<td><strong>' + esc(r.name) + '</strong>' + wl + '<span class="sub">' + esc(r.slug) + '</span></td>' +
    '<td>' + esc(r.category ?? '—') + '</td>' +
    '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
    '<td class="num">' + usd(r.tvl_usd) + '</td>' +
    '<td class="num ' + changeClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
    '<td class="num">' + ageText(r.age_days) + '</td>' +
    '<td class="num"><strong>' + usd(r.implied_value_usd) + '</strong></td></tr>';
}

function renderBoard() {
  const rows = sortedRows(filteredRows());
  $('count').textContent = rows.length + ' of ' + D.rows.length + ' protocols · ranked by ' +
    ({ value: 'implied value', tvl: 'TVL', growth: '7-day change', age: 'age', name: 'name' }[state.sort]);
  $('boardBody').innerHTML = rows.map(boardRowHtml).join('') ||
    '<tr><td colspan="8">No protocol matches this filter.</td></tr>';
  document.querySelectorAll('#boardBody tr.clickable').forEach((tr) => {
    tr.addEventListener('click', () => showDetail(tr.dataset.slug));
  });
  renderDetail();
}

function renderDetail() {
  const panel = $('detail');
  const r = D.rows.find((x) => x.slug === state.detail);
  if (!r) { panel.hidden = true; panel.innerHTML = ''; return; }
  const math = usd(r.tvl_usd) + ' × ' + r.multiple.toFixed(3) + ' (category) × ' +
    r.growth_multiplier.toFixed(3) + ' (growth) × ' + r.maturity_multiplier.toFixed(3) +
    ' (maturity) × ' + r.chain_multiplier.toFixed(3) + ' (chains) = <strong>' + usd(r.implied_value_usd) + '</strong>';
  panel.innerHTML =
    '<h2>' + esc(r.name) + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
    '<p class="slug">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + D.rows.length +
    ' · records no token (no market cap, no CoinGecko id, no symbol in its record)</p>' +
    '<p class="big">' + usd(r.implied_value_usd) + '</p>' +
    '<p class="biglabel">Implied value of the token it may one day issue</p>' +
    '<div class="kv">' +
    '<div><b>' + usd(r.tvl_usd) + '</b><span>Total value locked</span></div>' +
    '<div><b class="' + changeClass(r.change_7d) + '">' + pct(r.change_7d) + '</b><span>TVL change, 7 days</span></div>' +
    '<div><b>' + ageText(r.age_days) + '</b><span>Protocol age</span></div>' +
    '<div><b>' + esc(r.chains.join(', ') || '—') + '</b><span>Chains</span></div>' +
    '</div>' +
    '<div class="math">How the value is built: <code>' + esc(math.replace(/<[^>]+>/g, '')) + '</code></div>' +
    '<h3>How to farm it — 7 steps</h3>' +
    '<ol class="farm">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
  panel.hidden = false;
}

function showDetail(slug) {
  state.detail = slug;
  location.hash = '#/protocol/' + slug;
  renderBoard();
  $('detail').scrollIntoView({ block: 'nearest' });
}

function renderLive() {
  $('liveBody').innerHTML = D.live.map((p) =>
    '<tr><td><strong>' + esc(p.name) + '</strong><span class="sub">' + esc(p.slug) + '</span></td>' +
    '<td>' + esc(p.category ?? '—') + '</td>' +
    '<td>' + esc(p.chains.slice(0, 2).join(', ') || '—') + '</td>' +
    '<td class="num">' + usd(p.tvl_usd) + '</td>' +
    '<td class="num"><strong>' + usd(p.mcap_usd) + '</strong></td>' +
    '<td class="num">' + (p.mcap_per_tvl === null ? '—' : p.mcap_per_tvl.toFixed(3)) + '</td>' +
    '<td class="num ' + changeClass(p.change_7d) + '">' + pct(p.change_7d) + '</td></tr>'
  ).join('');
}

function renderSetAside() {
  $('setAsideBody').innerHTML = D.set_aside.map((p) =>
    '<tr><td><strong>' + esc(p.name) + '</strong><span class="sub">' + esc(p.slug) + '</span></td>' +
    '<td>' + esc(p.category ?? '—') + '</td>' +
    '<td class="num">' + usd(p.tvl_usd) + '</td>' +
    '<td style="white-space:normal; min-width:280px">' + esc(p.reason) + '</td></tr>'
  ).join('');
}

function renderMultiples() {
  $('globalMed').textContent = D.global_median_ratio.toFixed(3);
  $('multBody').innerHTML = D.multiples.map((m) =>
    '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.live_count + '</td>' +
    '<td class="num">' + (m.median_ratio === null ? '—' : m.median_ratio.toFixed(3)) + '</td>' +
    '<td class="num"><strong>' + m.multiple.toFixed(3) + '</strong></td></tr>'
  ).join('');
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['board', 'live', 'setaside', 'model'].forEach((t) => { $('view-' + t).hidden = t !== tab; });
  if (tab === 'live') renderLive();
  if (tab === 'setaside') renderSetAside();
  if (tab === 'model') renderMultiples();
}

function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/protocol\/([\w-]+)/);
  if (m) { setTab('board'); state.detail = m[1]; renderBoard(); const p = $('detail'); if (!p.hidden) p.scrollIntoView(); return; }
  if (h === '#/live') { setTab('live'); return; }
  if (h === '#/set-aside') { setTab('setaside'); return; }
  if (h === '#/model') { setTab('model'); return; }
  setTab('board');
  state.detail = null;
  renderBoard();
}

function init() {
  $('asOf').textContent = 'snapshot ' + D.as_of;
  $('metaLine').textContent = 'Source: ' + D.source + ' · Watchlist floor $' +
    D.floor_usd.toLocaleString('en-US') + ' · Model ' + D.model_version + ' · ' + D.rows.length + ' rows';
  $('sourceLine').textContent = 'Data: ' + D.source + '. Snapshot date ' + D.as_of + '.';
  const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
  cats.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o); });
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  chains.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o); });
  $('stats').innerHTML =
    '<div class="stat"><b>' + D.rows.length + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + D.watchlist_size + ' / ' + D.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + D.early_size + '</b><span>early finds below the floor</span></div>' +
    '<div class="stat"><b>' + D.live_size + '</b><span>live tokens tracked separately</span></div>';
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
  $('wlOnly').addEventListener('change', (e) => { state.wlOnly = e.target.checked; renderBoard(); });
  $('earlyOnly').addEventListener('change', (e) => { state.earlyOnly = e.target.checked; renderBoard(); });
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      location.hash = b.dataset.tab === 'board' ? '#/' : b.dataset.tab === 'setaside' ? '#/set-aside' : '#/' + b.dataset.tab;
    });
  });
  window.addEventListener('hashchange', route);
  route();
  window.__shotReady = true;
}

init();
