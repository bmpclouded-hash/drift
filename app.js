// ============================================================
// DRIFT — app.js
// Reads/writes live data from Supabase: products, boat position,
// hails, catches, and delivery orders. See supabase/schema.sql
// for the tables this expects, and README.md for setup steps.
// ============================================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const appBody = document.getElementById('appBody');
const headerSub = document.getElementById('headerSub');
const tabs = document.querySelectorAll('.tab');

const CATEGORY_META = {
  ice:      {label:'Ice',            emoji:'🧊', desc:'Bagged & cooler-fill'},
  bait:     {label:'Bait & Tackle',  emoji:'🎣', desc:'Fresh bait, fast fixes'},
  food:     {label:'Food & Drinks',  emoji:'🥪', desc:'Grab-and-go'},
  supplies: {label:'Supplies',       emoji:'🧰', desc:'What you forgot'},
};

// Stylized route map — purely visual. The real signal (route_index) comes from boat_status.
const ROUTE = [
  {name:'Marina Point',   top:'12%', left:'20%'},
  {name:'Oyster Bar',     top:'8%',  left:'52%'},
  {name:'North Flats',    top:'28%', left:'78%'},
  {name:'Sunset Cove',    top:'55%', left:'82%'},
  {name:'Inlet Mouth',    top:'78%', left:'58%'},
  {name:'Grass Line',     top:'82%', left:'26%'},
];
const USER_LOCATION = {top:'50%', left:'40%'};

const SPECIES = ['Redfish','Speckled Trout','Flounder','Sheepshead','Black Drum','Snook'];
const BAITS = ['Live shrimp','Mud minnow','Topwater lure','Frozen mullet','Soft plastic','Cut bait'];
const SPOTS = ['North Flats','Sunset Cove','Grass Line','Inlet Mouth','Oyster Bar'];
const SPECIES_ICON = {'Redfish':'🐟','Speckled Trout':'🐠','Flounder':'🐟','Sheepshead':'🐡','Black Drum':'🐟','Snook':'🐠'};

const TIERS = [
  {id:'free', name:'Free Boater', price:'No cost', perks:['App access','Standard pricing','Standard hail fee']},
  {id:'member', name:'Member', price:'$9/mo', perks:['10% store discount','Waived hail fee','Priority pre-order queue']},
  {id:'premium', name:'Premium Captain', price:'$29/mo', perks:['Free cooler-fill ice','Guaranteed same-day hail response','Discounted onboard prices']},
  {id:'elite', name:'Elite', price:'$79/mo', perks:['Standing sunset-run reservation','Free boat-side delivery, always','Direct text line to the boat']},
];

let state = {
  tab: 'track',
  located: false,
  userLat: null,
  userLng: null,
  cart: [],
  activeCat: 'ice',
  currentOrder: null,   // {id, status}
  tier: 'premium',
  showLogForm: false,
  justLogged: false,
  ownerMode: false,
  manageCat: 'ice',
  editingIndex: null,
  session: null,
  loading: true,
};

let CATALOG = {};   // { ice: {label,emoji,desc,items:[{id,name,price}]}, ... }
let CATCHES = [];
let BOAT = { route_index: 0, hailed: false, hail_note: null, eta_minutes: 22 };

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
async function init(){
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  state.ownerMode = !!session;

  await Promise.all([fetchProducts(), fetchBoatStatus(), fetchCatches()]);
  state.loading = false;
  render();
  subscribeRealtime();

  sb.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    state.ownerMode = !!session;
    if (!state.ownerMode && state.tab === 'manage') state.tab = 'shop';
    render();
  });
}

async function fetchProducts(){
  const { data, error } = await sb.from('products').select('*').order('created_at');
  if (error) { console.error(error); return; }
  const grouped = {};
  Object.keys(CATEGORY_META).forEach(k => grouped[k] = { ...CATEGORY_META[k], items: [] });
  (data || []).forEach(p => {
    if (!grouped[p.category]) grouped[p.category] = { label:p.category, emoji:'📦', desc:'', items:[] };
    grouped[p.category].items.push({ id:p.id, name:p.name, price:Number(p.price) });
  });
  CATALOG = grouped;
}

async function fetchBoatStatus(){
  const { data, error } = await sb.from('boat_status').select('*').eq('id', 1).single();
  if (error) { console.error(error); return; }
  BOAT = data;
}

async function fetchCatches(){
  const { data, error } = await sb.from('catches').select('*').order('logged_at', { ascending:false }).limit(20);
  if (error) { console.error(error); return; }
  CATCHES = data || [];
}

function subscribeRealtime(){
  sb.channel('boat_status_changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'boat_status' }, payload => {
      BOAT = payload.new;
      if (state.tab === 'track') render();
    }).subscribe();

  sb.channel('products_changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'products' }, async () => {
      await fetchProducts();
      if (state.tab === 'shop' || state.tab === 'manage') render();
    }).subscribe();

  sb.channel('catches_changes')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'catches' }, payload => {
      CATCHES = [payload.new, ...CATCHES].slice(0, 20);
      if (state.tab === 'fish') render();
    }).subscribe();

  sb.channel('orders_changes')
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' }, payload => {
      if (state.currentOrder && payload.new.id === state.currentOrder.id){
        state.currentOrder.status = payload.new.status;
        if (state.tab === 'shop') render();
      }
    }).subscribe();
}

// ------------------------------------------------------------
// RENDER DISPATCH
// ------------------------------------------------------------
function render(){
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
  document.querySelectorAll('.owner-only').forEach(el => el.style.display = state.ownerMode ? 'flex' : 'none');
  const ownerBtn = document.getElementById('ownerToggle');
  if (ownerBtn) ownerBtn.classList.toggle('on', state.ownerMode);

  headerSub.textContent = state.loading
    ? 'Loading…'
    : state.ownerMode
      ? 'Owner view · editing live catalog'
      : (state.located
          ? (BOAT.hailed ? `Hailed · ETA ${BOAT.eta_minutes} min` : 'Location set · on today\u2019s route')
          : 'Set your location to get started');

  if (state.loading) { appBody.innerHTML = `<div class="section-note">Connecting to Drift…</div>`; return; }

  if (state.tab === 'track') renderTrack();
  else if (state.tab === 'shop') renderShop();
  else if (state.tab === 'fish') renderFish();
  else if (state.tab === 'manage') renderManage();
  else renderAccount();
}

// ------------------------------------------------------------
// TRACK TAB
// ------------------------------------------------------------
function renderTrack(){
  const boat = ROUTE[BOAT.route_index % ROUTE.length];
  let html = `
    <div class="section-title">Where's Drift One</div>
    <div class="section-note">Live position, today's route, and your spot on the water.</div>
    <div class="map-wrap">
      <div class="water-map">`;
  ROUTE.forEach(c=>{
    html += `<div class="cove" style="top:${c.top};left:${c.left}"></div>
      <div class="cove-label" style="top:calc(${c.top} + 10px);left:${c.left}">${c.name}</div>`;
  });
  if (state.located){
    html += `<div class="user-pin" style="top:${USER_LOCATION.top};left:${USER_LOCATION.left}" title="Your location"></div>
      <div class="cove-label" style="top:calc(${USER_LOCATION.top} + 6px);left:calc(${USER_LOCATION.left} + 10px); color:var(--rust);">You</div>`;
  }
  html += `<div class="boat-icon" style="top:${boat.top};left:${boat.left}">🚤</div>
    </div>
      <div class="legend">
        <span><i class="dot" style="background:#8FB6AC"></i>Route stop</span>
        <span><i class="dot" style="background:#C1622D"></i>Your location</span>
        <span>🚤 Drift One</span>
      </div>
    </div>`;

  if (!state.located){
    html += `<button class="hail-btn" id="setLocBtn">Set my location</button>
      <div class="hail-hint">Uses your device's GPS so Drift One and the owner know roughly where you are.</div>`;
  } else {
    html += `<div class="eta-card">
      <div class="eta-top">
        <div>
          <div class="eta-label">${BOAT.hailed ? 'HAILED · ETA' : 'CURRENTLY NEAR'}</div>
          <div class="eta-value">${BOAT.hailed ? (BOAT.eta_minutes > 0 ? BOAT.eta_minutes + ' min' : 'Arriving now') : boat.name}</div>
        </div>
      </div>
      <div class="eta-sub">${
        BOAT.hailed
          ? `Drift One has your hail and is adjusting course.`
          : `Drift One is running its published route today and will pass near you.`
      }</div>
    </div>
    <button class="hail-btn ${BOAT.hailed?'sent':''}" id="hailBtn">${
      BOAT.hailed ? 'Cancel hail' : 'Request a stop'
    }</button>
    <div class="hail-hint">${BOAT.hailed ? '' : 'Or just wait — it\u2019s already headed your way on today\u2019s route.'}</div>`;
  }

  appBody.innerHTML = html;

  const setLocBtn = appBody.querySelector('#setLocBtn');
  if (setLocBtn) setLocBtn.addEventListener('click', requestLocation);

  const hailBtn = appBody.querySelector('#hailBtn');
  if (hailBtn) hailBtn.addEventListener('click', toggleHail);
}

function requestLocation(){
  if (!navigator.geolocation){
    state.located = true; state.userLat = null; state.userLng = null;
    render();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.located = true;
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      render();
    },
    () => { state.located = true; render(); },
    { timeout:8000 }
  );
}

async function toggleHail(){
  const hailNote = (state.userLat != null)
    ? `${state.userLat.toFixed(4)}, ${state.userLng.toFixed(4)}`
    : 'Location unavailable';
  const next = !BOAT.hailed;
  const { data, error } = await sb.from('boat_status')
    .update({ hailed: next, hail_note: next ? hailNote : null, eta_minutes: next ? 8 : 22, updated_at: new Date().toISOString() })
    .eq('id', 1).select().single();
  if (!error && data) BOAT = data;
  render();
}

// ------------------------------------------------------------
// SHOP TAB
// ------------------------------------------------------------
function renderShop(){
  let html = `<div class="section-title">Order Ahead</div>
    <div class="section-note">Order now — Drift One brings it right to your boat.</div>
    <div class="cat-grid">`;
  Object.entries(CATALOG).forEach(([key,cat])=>{
    html += `<button class="cat-card ${state.activeCat===key?'active':''}" data-cat="${key}">
      <div class="cat-emoji">${cat.emoji}</div>
      <div class="cat-name">${cat.label}</div>
      <div class="cat-desc">${cat.desc}</div>
    </button>`;
  });
  html += `</div>`;

  if (state.currentOrder){
    html += renderTracker();
  } else if (CATALOG[state.activeCat]) {
    CATALOG[state.activeCat].items.forEach((item)=>{
      html += `<div class="item-row">
        <div><div class="item-name">${item.name}</div><div class="item-price">$${item.price.toFixed(2)}</div></div>
        <button class="add-btn" data-add="${item.id}">+</button>
      </div>`;
    });
  }
  appBody.innerHTML = html;

  if (state.cart.length && !state.currentOrder){
    const total = state.cart.reduce((a,c)=>a+c.price,0);
    const bar = document.createElement('div');
    bar.className = 'cart-bar';
    bar.innerHTML = `<span>${state.cart.length} item${state.cart.length>1?'s':''} · $${total.toFixed(2)}</span>
      <button id="deliverBtn">${state.located ? 'Deliver to my boat' : 'Set location first'}</button>`;
    appBody.appendChild(bar);
    bar.querySelector('#deliverBtn').addEventListener('click', ()=>{
      if (!state.located) { state.tab='track'; render(); return; }
      placeOrder();
    });
  }

  appBody.querySelectorAll('[data-cat]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ state.activeCat = btn.dataset.cat; render(); });
  });
  appBody.querySelectorAll('[data-add]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const item = CATALOG[state.activeCat].items.find(i => i.id === btn.dataset.add);
      if (item) state.cart.push(item);
      render();
    });
  });
}

async function placeOrder(){
  const total = state.cart.reduce((a,c)=>a+c.price,0);
  const locationNote = (state.userLat != null) ? `${state.userLat.toFixed(4)}, ${state.userLng.toFixed(4)}` : 'Set, coordinates unavailable';
  const { data, error } = await sb.from('orders').insert({
    items: state.cart.map(c => ({ name:c.name, price:c.price })),
    total, location_note: locationNote, status: 'placed'
  }).select().single();
  if (error) { console.error(error); return; }
  state.currentOrder = { id: data.id, status: 'placed' };
  render();
  runOrderSimulation(data.id);
}

// In production the crew updates order status from their own device.
// This simulates that progression so the demo (and a real early launch
// with one boat and no separate crew app) still shows live movement.
async function runOrderSimulation(orderId){
  const steps = ['assigned','en_route','delivered'];
  for (const step of steps){
    await new Promise(r => setTimeout(r, 1800));
    const { data, error } = await sb.from('orders').update({ status: step }).eq('id', orderId).select().single();
    if (!error && data && state.currentOrder && state.currentOrder.id === orderId){
      state.currentOrder.status = data.status;
      if (state.tab === 'shop') render();
    }
  }
}

function renderTracker(){
  const order = state.currentOrder;
  const labels = [
    {key:'placed', l:'Order placed', t:'Confirmed'},
    {key:'assigned', l:'Crew assigned', t:'On Drift One'},
    {key:'en_route', l:'On the way to your boat', t:'En route'},
    {key:'delivered', l:'Delivered to your boat', t:'Enjoy'},
  ];
  const stepIndex = labels.findIndex(l => l.key === order.status);
  let html = `<div class="track-wrap">`;
  labels.forEach((s, idx)=>{
    const done = idx <= stepIndex;
    html += `<div class="track-step">
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div class="track-dot ${done?'done':''}">${done?'✓':idx+1}</div>
        ${idx < labels.length-1 ? `<div class="track-line ${idx<stepIndex?'done':''}" style="height:24px;"></div>` : ''}
      </div>
      <div style="padding-top:1px;">
        <div class="track-label">${s.l}</div>
        <div class="track-time">${done ? s.t : '—'}</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  if (order.status === 'delivered'){
    html += `<div class="eta-card" style="margin-top:12px;">Delivered. Head back to Shop to start a new order.</div>
      <button class="hail-btn" id="resetOrder" style="margin-top:10px;">New order</button>`;
  }
  return html;
}

// ------------------------------------------------------------
// FISH TAB
// ------------------------------------------------------------
function computeHotBite(){
  if (!CATCHES.length) return { species:'—', bait:'—', spot:'—' };
  const counts = {};
  CATCHES.forEach(c => counts[c.species] = (counts[c.species]||0) + 1);
  let topSpecies = CATCHES[0].species, max = 0;
  Object.entries(counts).forEach(([sp,ct])=>{ if (ct > max){ max = ct; topSpecies = sp; } });
  const matching = CATCHES.filter(c => c.species === topSpecies);
  const baitCounts = {};
  matching.forEach(c => baitCounts[c.bait] = (baitCounts[c.bait]||0)+1);
  let topBait = matching[0].bait, bmax = 0;
  Object.entries(baitCounts).forEach(([b,ct])=>{ if (ct > bmax){ bmax = ct; topBait = b; } });
  return { species: topSpecies, bait: topBait, spot: matching[0].spot };
}

function timeAgo(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hr ago`;
}

function renderFish(){
  const hb = computeHotBite();
  let html = `
    <div class="angr-badge"><span class="angr-dot"></span>LIVE CATCH FEED</div>
    <div class="section-title">On the Water Today</div>
    <div class="section-note">Every catch logged here updates this board in real time for everyone.</div>
    <div class="hotbite">
      <div class="h-label">TODAY'S HOT BITE</div>
      <div class="h-main">${hb.species} on ${hb.bait}</div>
      <div class="h-sub">Best spot right now: ${hb.spot}</div>
    </div>
    <button class="log-catch-btn" id="logCatchBtn">${state.showLogForm ? '– Close' : '+ Log a catch'}</button>
    ${state.showLogForm ? `
    <div class="log-form">
      <label>Species</label>
      <select id="logSpecies">${SPECIES.map(s=>`<option>${s}</option>`).join('')}</select>
      <label>Bait / lure</label>
      <select id="logBait">${BAITS.map(b=>`<option>${b}</option>`).join('')}</select>
      <label>Spot</label>
      <select id="logSpot">${SPOTS.map(s=>`<option>${s}</option>`).join('')}</select>
      <button class="log-submit" id="submitCatch">Post to the board</button>
    </div>` : ''}
    <div class="section-title" style="font-size:15px;">Recent catches</div>`;
  CATCHES.forEach((c,i)=>{
    html += `<div class="catch-row ${i===0 && state.justLogged ? 'new-pulse' : ''}">
      <div class="catch-icon">${SPECIES_ICON[c.species]||'🐟'}</div>
      <div><div class="catch-name">${c.species}</div><div class="catch-meta">${timeAgo(c.logged_at)} · ${c.bait} · ${c.spot}</div></div>
    </div>`;
  });
  appBody.innerHTML = html;

  const logBtn = appBody.querySelector('#logCatchBtn');
  if (logBtn) logBtn.addEventListener('click', ()=>{ state.showLogForm = !state.showLogForm; render(); });

  const submitBtn = appBody.querySelector('#submitCatch');
  if (submitBtn) submitBtn.addEventListener('click', async ()=>{
    const species = document.getElementById('logSpecies').value;
    const bait = document.getElementById('logBait').value;
    const spot = document.getElementById('logSpot').value;
    const { data, error } = await sb.from('catches').insert({ species, bait, spot, source:'drift' }).select().single();
    if (!error && data){
      CATCHES = [data, ...CATCHES];
      state.showLogForm = false;
      state.justLogged = true;
      render();
      setTimeout(()=>{ state.justLogged = false; }, 900);
    }
  });
}

// ------------------------------------------------------------
// ACCOUNT TAB
// ------------------------------------------------------------
function renderAccount(){
  let html = `<div class="section-title">Membership</div>
    <div class="section-note">You're on Premium Captain — tap another tier to compare.</div>`;
  TIERS.forEach(t=>{
    const active = t.id === state.tier;
    html += `<div class="tier-card ${active?'active':''}" data-tier="${t.id}">
      <div class="tier-top">
        <div class="tier-name">${t.name}</div>
        <div class="tier-price">${t.price}</div>
      </div>
      ${active ? '<div class="tier-badge">YOUR CURRENT TIER</div>' : ''}
      <ul class="tier-perks">${t.perks.map(p=>`<li>${p}</li>`).join('')}</ul>
    </div>`;
  });
  appBody.innerHTML = html;
  appBody.querySelectorAll('[data-tier]').forEach(card=>{
    card.addEventListener('click', ()=>{ state.tier = card.dataset.tier; render(); });
  });
}

// ------------------------------------------------------------
// MANAGE (OWNER) TAB
// ------------------------------------------------------------
function renderManage(){
  const boatCove = ROUTE[BOAT.route_index % ROUTE.length];
  let html = `
    <div class="manage-banner">Owner View — changes here go straight to Supabase and every customer sees them live.</div>`;

  if (BOAT.hailed){
    html += `<div class="eta-card" style="margin-bottom:14px;">
      <div class="eta-label">ACTIVE HAIL</div>
      <div class="eta-value" style="font-size:15px;">${BOAT.hail_note || 'Location unavailable'}</div>
      <div class="eta-sub">A customer is waiting on a stop.</div>
    </div>`;
  }

  html += `
    <div class="section-title" style="font-size:16px;">Boat Position</div>
    <div class="section-note">Currently at <b>${boatCove.name}</b>. Advance it as Drift One actually moves.</div>
    <button class="advance-btn" id="advanceBtn">Advance to next stop →</button>

    <div class="section-title" style="margin-top:20px;">Manage Products</div>
    <div class="section-note">Pick a category, edit prices, remove items, or add something new.</div>
    <div class="cat-grid">`;
  Object.entries(CATALOG).forEach(([key,cat])=>{
    html += `<button class="cat-card ${state.manageCat===key?'active':''}" data-mcat="${key}">
      <div class="cat-emoji">${cat.emoji}</div>
      <div class="cat-name">${cat.label}</div>
      <div class="cat-desc">${cat.items.length} item${cat.items.length===1?'':'s'}</div>
    </button>`;
  });
  html += `</div>`;

  const activeCat = CATALOG[state.manageCat];
  if (activeCat){
    activeCat.items.forEach((item, i)=>{
      const editing = state.editingIndex === i;
      html += `<div class="manage-item">
        <div>
          <div class="m-name">${item.name}</div>
          ${editing
            ? `<div class="m-price-view">$ <input type="number" step="0.5" id="editPrice" value="${item.price}"></div>`
            : `<div class="m-price-view">$${item.price.toFixed(2)}</div>`
          }
        </div>
        <div class="m-actions">
          ${editing
            ? `<button class="m-btn save" data-save="${item.id}">✓</button>`
            : `<button class="m-btn edit" data-edit="${i}">✎</button>`
          }
          <button class="m-btn del" data-del="${item.id}">✕</button>
        </div>
      </div>`;
    });
  }

  html += `
    <div class="add-product-form">
      <label>Product name</label>
      <input type="text" id="newProdName" placeholder="e.g. Dockside Cold Brew">
      <label>Price ($)</label>
      <input type="number" step="0.5" id="newProdPrice" placeholder="0.00">
      <button class="add-submit" id="addProdBtn">Add to ${activeCat ? activeCat.label : state.manageCat}</button>
    </div>
    <button class="hail-btn" id="signOutBtn" style="margin-top:20px;background:none;border:1.5px solid #DCD3BC;color:var(--navy);">Sign out</button>`;

  appBody.innerHTML = html;

  const advanceBtn = appBody.querySelector('#advanceBtn');
  if (advanceBtn) advanceBtn.addEventListener('click', async ()=>{
    const nextIndex = (BOAT.route_index + 1) % ROUTE.length;
    const { data, error } = await sb.from('boat_status')
      .update({ route_index: nextIndex, updated_at: new Date().toISOString() })
      .eq('id', 1).select().single();
    if (!error && data) BOAT = data;
    render();
  });

  appBody.querySelectorAll('[data-mcat]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ state.manageCat = btn.dataset.mcat; state.editingIndex = null; render(); });
  });
  appBody.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ state.editingIndex = Number(btn.dataset.edit); render(); });
  });
  appBody.querySelectorAll('[data-save]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.save;
      const val = parseFloat(document.getElementById('editPrice').value);
      if (!isNaN(val) && val >= 0){
        await sb.from('products').update({ price: val }).eq('id', id);
        await fetchProducts();
      }
      state.editingIndex = null;
      render();
    });
  });
  appBody.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      await sb.from('products').delete().eq('id', btn.dataset.del);
      await fetchProducts();
      state.editingIndex = null;
      render();
    });
  });
  const addBtn = appBody.querySelector('#addProdBtn');
  if (addBtn) addBtn.addEventListener('click', async ()=>{
    const name = document.getElementById('newProdName').value.trim();
    const price = parseFloat(document.getElementById('newProdPrice').value);
    if (!name || isNaN(price) || price < 0) return;
    await sb.from('products').insert({ category: state.manageCat, name, price });
    await fetchProducts();
    render();
  });
  const signOutBtn = appBody.querySelector('#signOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', async ()=>{
    await sb.auth.signOut();
  });
}

// ------------------------------------------------------------
// TAB BAR + OWNER LOGIN MODAL
// ------------------------------------------------------------
tabs.forEach(t=>{
  t.addEventListener('click', ()=>{ state.tab = t.dataset.tab; render(); });
});

const loginBackdrop = document.getElementById('loginBackdrop');
document.getElementById('ownerToggle').addEventListener('click', async ()=>{
  if (state.ownerMode){
    await sb.auth.signOut();
    return;
  }
  loginBackdrop.classList.add('open');
  document.getElementById('loginError').textContent = '';
});
document.getElementById('loginCancel').addEventListener('click', ()=>{
  loginBackdrop.classList.remove('open');
});
document.getElementById('loginSubmit').addEventListener('click', async ()=>{
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error){ errEl.textContent = error.message; return; }
  loginBackdrop.classList.remove('open');
  state.session = data.session;
  state.ownerMode = true;
  state.tab = 'manage';
  render();
});

document.addEventListener('click', (e)=>{
  if (e.target && e.target.id === 'resetOrder'){
    state.cart = [];
    state.currentOrder = null;
    render();
  }
});

init();
