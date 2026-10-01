(() => {
  const FREE_SHIPPING = 20;
  const SHIPPING_COST = 3.95;
  const $ = (s) => document.querySelector(s);
  const eur = (n) => n.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
  const byId = (id) => PRODUCTS.find((p) => p.id === id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  };

  const state = {
    cat: null,
    query: "",
    sort: "pop",
    dealOnly: false,
    favOnly: false,
    cart: store.get("pp-cart", {}),   // { productId: qty }
    favs: new Set(store.get("pp-favs", [])),
  };

  /* ---------- Rendering helpers ---------- */
  function priceHtml(p) {
    const [whole, cents] = p.price.toFixed(2).split(".");
    return `<div>${p.old ? `<span class="old">${eur(p.old)}</span>` : ""}
      <span class="price ${p.old ? "sale" : ""}">${whole},<sup>${cents}</sup></span></div>`;
  }
  function starsHtml(p) {
    const full = Math.round(p.rating);
    return `<div class="stars" aria-label="${p.rating} van 5 sterren">${"★".repeat(full)}${"☆".repeat(5 - full)} <small>(${p.reviews})</small></div>`;
  }
  function cardHtml(p) {
    const label = p.old ? `<span class="label sale">-${Math.round((1 - p.price / p.old) * 100)}%</span>`
      : p.tag ? `<span class="label">${p.tag}</span>` : "";
    return `<article class="card">
      <button class="card-img" style="background:${p.color}" data-view="${p.id}" aria-label="Bekijk ${esc(p.name)}">${p.emoji}</button>
      ${label}
      <button class="fav" data-fav="${p.id}" aria-label="Favoriet">${state.favs.has(p.id) ? "♥" : "♡"}</button>
      <div class="card-body">
        <button class="card-title" data-view="${p.id}">${esc(p.name)}</button>
        ${starsHtml(p)}
        <div class="price-row">${priceHtml(p)}
          <button class="add-btn" data-add="${p.id}" aria-label="In winkelwagen">🛒</button>
        </div>
      </div>
    </article>`;
  }

  function renderNav() {
    const items = [{ id: null, name: "Alles", icon: "🏠" }, ...CATEGORIES];
    $("#catnavInner").innerHTML = items.map((c) =>
      `<button data-cat="${c.id ?? ""}" class="${state.cat === c.id ? "active" : ""}">${c.name}</button>`).join("");
    $("#catGrid").innerHTML = CATEGORIES.map((c) =>
      `<button class="cat-tile" data-cat="${c.id}"><span>${c.icon}</span>${c.name}</button>`).join("");
    $("#menuList").innerHTML = `<div class="menu-list">${items.map((c) =>
      `<button data-cat="${c.id ?? ""}"><span>${c.icon}</span>${c.name}</button>`).join("")}</div>`;
  }

  function renderDeals() {
    $("#dealRail").innerHTML = PRODUCTS.filter((p) => p.old).map(cardHtml).join("");
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    let list = PRODUCTS.filter((p) =>
      (!state.cat || p.cat === state.cat) &&
      (!state.dealOnly || p.old) &&
      (!state.favOnly || state.favs.has(p.id)) &&
      (!q || p.name.toLowerCase().includes(q) || CATEGORIES.find((c) => c.id === p.cat).name.toLowerCase().includes(q)));
    const sorters = {
      pop: (a, b) => b.reviews - a.reviews,
      low: (a, b) => a.price - b.price,
      high: (a, b) => b.price - a.price,
      rating: (a, b) => b.rating - a.rating,
    };
    return list.sort(sorters[state.sort]);
  }

  function renderGrid() {
    const list = filtered();
    const cat = CATEGORIES.find((c) => c.id === state.cat);
    $("#shopTitle").textContent = state.favOnly ? "Je favorieten"
      : state.query ? `Zoekresultaten voor “${state.query}”`
      : cat ? cat.name : "Alle producten";
    $("#resultCount").textContent = `${list.length} ${list.length === 1 ? "product" : "producten"}`;
    $("#productGrid").innerHTML = list.length ? list.map(cardHtml).join("")
      : `<div class="empty"><p style="font-size:40px;margin:0">🔎</p><p>Geen producten gevonden.</p><button class="btn btn-primary" data-reset>Toon alle producten</button></div>`;
    document.querySelectorAll("#catnavInner button").forEach((b) =>
      b.classList.toggle("active", (b.dataset.cat || null) === state.cat && !state.favOnly));
  }

  /* ---------- Cart ---------- */
  function cartLines() {
    return Object.entries(state.cart).map(([id, qty]) => ({ p: byId(+id), qty })).filter((l) => l.p);
  }
  function totals() {
    const sub = cartLines().reduce((s, l) => s + l.p.price * l.qty, 0);
    const ship = sub === 0 || sub >= FREE_SHIPPING ? 0 : SHIPPING_COST;
    return { sub, ship, total: sub + ship };
  }
  function saveCart() { store.set("pp-cart", state.cart); renderCart(); }

  function addToCart(id, qty = 1) {
    state.cart[id] = (state.cart[id] || 0) + qty;
    saveCart();
    toast(`✔ ${byId(id).name} toegevoegd`);
  }

  function renderCart() {
    const lines = cartLines();
    const count = lines.reduce((s, l) => s + l.qty, 0);
    const badge = $("#cartCount");
    badge.textContent = count; badge.hidden = count === 0;

    if (!lines.length) {
      $("#cartItems").innerHTML = `<div class="empty" style="box-shadow:none"><p style="font-size:44px;margin:0">🛒</p><p>Je winkelwagen is nog leeg.</p></div>`;
      $("#cartFoot").innerHTML = `<button class="btn btn-primary btn-block" data-close>Verder winkelen</button>`;
      return;
    }
    $("#cartItems").innerHTML = lines.map(({ p, qty }) => `
      <div class="line">
        <div class="line-img" style="background:${p.color}">${p.emoji}</div>
        <div>
          <div class="line-name">${esc(p.name)}</div>
          <div class="qty"><button data-dec="${p.id}" aria-label="Minder">−</button><span>${qty}</span><button data-inc="${p.id}" aria-label="Meer">+</button></div>
          <button class="remove" data-remove="${p.id}">Verwijderen</button>
        </div>
        <div class="line-price">${eur(p.price * qty)}</div>
      </div>`).join("");

    const t = totals();
    const left = FREE_SHIPPING - t.sub;
    $("#cartFoot").innerHTML = `
      <div class="ship-msg">${left > 0 ? `Nog <b>${eur(left)}</b> tot gratis bezorging` : "🎉 Je bestelling wordt gratis bezorgd!"}</div>
      <div class="ship-bar"><i style="width:${Math.min(100, (t.sub / FREE_SHIPPING) * 100)}%"></i></div>
      <div class="sum-row"><span>Subtotaal</span><span>${eur(t.sub)}</span></div>
      <div class="sum-row"><span>Bezorgkosten</span><span>${t.ship ? eur(t.ship) : "Gratis"}</span></div>
      <div class="sum-row total"><span>Totaal</span><span>${eur(t.total)}</span></div>
      <button class="btn btn-accent btn-block" data-checkout>Verder naar bestellen</button>`;
  }

  /* ---------- Favorites ---------- */
  function toggleFav(id) {
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    store.set("pp-favs", [...state.favs]);
    renderFavCount();
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => (b.textContent = state.favs.has(id) ? "♥" : "♡"));
    if (state.favOnly) renderGrid();
  }
  function renderFavCount() {
    const b = $("#favCount");
    b.textContent = state.favs.size; b.hidden = state.favs.size === 0;
  }

  /* ---------- Drawers / modal ---------- */
  let openDrawer = null;
  function showDrawer(el) {
    closeAll();
    openDrawer = el;
    el.classList.add("open"); el.setAttribute("aria-hidden", "false");
    $("#overlay").hidden = false;
  }
  function showModal(html) {
    closeAll();
    $("#modalContent").innerHTML = html;
    $("#modal").hidden = false;
  }
  function closeAll() {
    if (openDrawer) { openDrawer.classList.remove("open"); openDrawer.setAttribute("aria-hidden", "true"); openDrawer = null; }
    $("#overlay").hidden = true;
    $("#modal").hidden = true;
  }

  function showProduct(id) {
    const p = byId(id);
    const cat = CATEGORIES.find((c) => c.id === p.cat);
    showModal(`<div class="pdp">
      <div class="pdp-img" style="background:${p.color}">${p.emoji}</div>
      <div>
        <small style="color:var(--muted)">${cat.name}</small>
        <h2>${esc(p.name)}</h2>
        ${starsHtml(p)}
        <div style="margin:14px 0">${priceHtml(p)}</div>
        <p class="stock">● Online op voorraad · morgen in huis</p>
        <ul><li>Artikelnummer ${String(3000000 + p.id * 137)}</li><li>Gratis afhalen in de winkel</li><li>30 dagen bedenktijd</li></ul>
        <div style="display:flex;gap:10px;align-items:center;margin-top:16px">
          <div class="qty"><button data-pdp-dec aria-label="Minder">−</button><span id="pdpQty">1</span><button data-pdp-inc aria-label="Meer">+</button></div>
          <button class="btn btn-primary" style="flex:1" data-pdp-add="${p.id}">In winkelwagen</button>
          <button class="fav" style="position:static" data-fav="${p.id}">${state.favs.has(p.id) ? "♥" : "♡"}</button>
        </div>
      </div></div>`);
  }

  function showCheckout() {
    const t = totals();
    showModal(`<h2 style="margin-top:0">Bestellen</h2>
      <form id="checkoutForm" class="form-grid">
        <label>Voornaam<input required name="first" autocomplete="given-name"></label>
        <label>Achternaam<input required name="last" autocomplete="family-name"></label>
        <label class="full">E-mailadres<input required type="email" name="email" autocomplete="email"></label>
        <label>Postcode<input required name="zip" pattern="[1-9][0-9]{3} ?[A-Za-z]{2}" placeholder="1234 AB" autocomplete="postal-code"></label>
        <label>Huisnummer<input required name="nr"></label>
        <label class="full">Bezorgen of ophalen
          <select name="delivery"><option>Thuisbezorgen</option><option>Gratis ophalen in de winkel</option></select></label>
        <div class="full"><b style="font-size:13px">Betaalmethode</b>
          <div class="pay-opts" style="margin-top:6px">
            ${["iDEAL", "Bancontact", "Creditcard", "PayPal"].map((m, i) => `<label><input type="radio" name="pay" value="${m}" ${i ? "" : "checked"}> ${m}</label>`).join("")}
          </div></div>
        <div class="full sum-row total" style="margin-top:8px"><span>Te betalen</span><span>${eur(t.total)}</span></div>
        <button class="btn btn-accent btn-block full">Bestelling plaatsen</button>
        <p class="full" style="font-size:12px;color:var(--muted);margin:0">Dit is een demo — er wordt niets afgerekend.</p>
      </form>`);
  }

  function placeOrder(form) {
    const data = new FormData(form);
    const nr = "PP" + Date.now().toString().slice(-8);
    state.cart = {}; saveCart();
    showModal(`<div style="text-align:center;padding:20px 0">
      <p style="font-size:60px;margin:0">🎉</p>
      <h2>Bedankt, ${esc(data.get("first"))}!</h2>
      <p>Je bestelling <b>${nr}</b> is geplaatst. We sturen een bevestiging naar <b>${esc(data.get("email"))}</b>.</p>
      <button class="btn btn-primary" data-close>Verder winkelen</button></div>`);
  }

  /* ---------- Misc ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function countdown() {
    // Weekdeals lopen tot dinsdag 23:59:59; elke woensdag nieuwe deals.
    const now = new Date();
    const end = new Date(now);
    end.setDate(now.getDate() + ((2 - now.getDay() + 7) % 7));
    end.setHours(23, 59, 59, 999);
    const ms = end - now;
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    $("#countdown").textContent = `Nog ${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function setCat(cat) {
    state.cat = cat || null; state.favOnly = false; state.query = ""; $("#searchInput").value = "";
    closeAll(); renderGrid();
    $("#shop").scrollIntoView({ behavior: "smooth" });
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;
    if ("cat" in d) { e.preventDefault(); return setCat(d.cat); }
    if (d.add) return addToCart(+d.add);
    if (d.fav) return toggleFav(+d.fav);
    if (d.view) return showProduct(+d.view);
    if (d.inc) { state.cart[d.inc]++; return saveCart(); }
    if (d.dec) { if (--state.cart[d.dec] <= 0) delete state.cart[d.dec]; return saveCart(); }
    if (d.remove) { delete state.cart[d.remove]; return saveCart(); }
    if ("checkout" in d) return showCheckout();
    if ("close" in d) return closeAll();
    if ("reset" in d) { state.dealOnly = false; $("#dealOnly").checked = false; return setCat(null); }
    if ("pdpInc" in d || "pdpDec" in d) {
      const q = $("#pdpQty"); q.textContent = Math.max(1, +q.textContent + ("pdpInc" in d ? 1 : -1)); return;
    }
    if (d.pdpAdd) { addToCart(+d.pdpAdd, +$("#pdpQty").textContent); return closeAll(); }
  });

  $("#cartBtn").addEventListener("click", () => showDrawer($("#cartDrawer")));
  $("#menuBtn").addEventListener("click", () => showDrawer($("#menuDrawer")));
  $("#overlay").addEventListener("click", closeAll);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeAll(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  $("#logoLink").addEventListener("click", (e) => { e.preventDefault(); setCat(null); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("#storesLink").addEventListener("click", (e) => { e.preventDefault(); toast("📍 Winkelzoeker komt binnenkort"); });
  $("#favBtn").addEventListener("click", (e) => {
    e.preventDefault(); state.favOnly = true; state.cat = null; renderGrid();
    $("#shop").scrollIntoView({ behavior: "smooth" });
  });

  let searchTimer;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; state.cat = null; state.favOnly = false; renderGrid(); }, 150);
  });
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault(); state.query = $("#searchInput").value; state.cat = null; state.favOnly = false;
    renderGrid(); $("#shop").scrollIntoView({ behavior: "smooth" });
  });
  $("#sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });
  $("#dealOnly").addEventListener("change", (e) => { state.dealOnly = e.target.checked; renderGrid(); });
  $("#newsForm").addEventListener("submit", (e) => { e.preventDefault(); e.target.reset(); toast("✔ Je bent aangemeld voor de nieuwsbrief"); });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "checkoutForm") { e.preventDefault(); placeOrder(e.target); }
  });

  /* ---------- Init ---------- */
  $("#year").textContent = new Date().getFullYear();
  renderNav(); renderDeals(); renderGrid(); renderCart(); renderFavCount();
  countdown(); setInterval(countdown, 1000);
})();
