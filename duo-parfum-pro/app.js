/* ========= CONFIGURE O FIREBASE AQUI ========= */
const firebaseConfig = {
  apiKey: "AIzaSyDVkpsr4z6LolEOkNTGcc9TmKeiu4-mi1Y",
  authDomain: "duoparfum-61ec2.firebaseapp.com",
  projectId: "duoparfum-61ec2",
  storageBucket: "duoparfum-61ec2.firebasestorage.app",
  messagingSenderId: "889684986920",
  appId: "1:889684986920:web:9d452daf2192124b19391d"
};
const ADMIN_EMAILS = ["guilherme.serraglio03@gmail.com"];
const WHATSAPP_PHONE = "5566992254072";
/* ============================================ */

let app, db, auth;
document.addEventListener("DOMContentLoaded", async () => {
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();

  document.getElementById("year").textContent = new Date().getFullYear();
  const els = {
    grid: byId("grid"),
    empty: byId("emptyState"),
    q: byId("q"),
    btnSearch: byId("btnSearch"),
    filterCategory: byId("filterCategory"),
    filterSort: byId("filterSort"),
    btnClearFilters: byId("btnClearFilters"),
    btnCart: byId("btnCart"),
    cartDrawer: byId("cartDrawer"),
    closeCart: byId("closeCart"),
    cartItems: byId("cartItems"),
    cartTotal: byId("cartTotal"),
    cartCount: byId("cartCount"),
    btnCheckout: byId("btnCheckout"),
    btnLogin: byId("btnLogin"),
    btnLogout: byId("btnLogout"),
    linkAdmin: byId("linkAdmin"),
    productModal: byId("productModal"),
    pmImg: byId("pmImg"),
    pmName: byId("pmName"),
    pmBrand: byId("pmBrand"),
    pmNotes: byId("pmNotes"),
    pmPrice: byId("pmPrice"),
    pmMl: byId("pmMl"),
    pmAdd: byId("pmAdd"),
    pmFav: byId("pmFav"),
    closeModal: byId("closeModal")
  };

  auth.onAuthStateChanged(user => {
    const logged = !!user;
    els.btnLogin.classList.toggle("hidden", logged);
    els.btnLogout.classList.toggle("hidden", !logged);
    const isAdmin = logged && ADMIN_EMAILS.includes(user.email);
    els.linkAdmin.classList.toggle("hidden", !isAdmin);
  });

  els.btnLogin.addEventListener("click", async ()=>{
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  });
  els.btnLogout.addEventListener("click", ()=> auth.signOut());

  els.btnSearch.addEventListener("click", renderProducts);
  els.filterCategory.addEventListener("change", renderProducts);
  els.filterSort.addEventListener("change", renderProducts);
  els.btnClearFilters.addEventListener("click", ()=>{
    els.q.value = "";
    els.filterCategory.value = "";
    els.filterSort.value = "featured";
    renderProducts();
  });

  els.btnCart.addEventListener("click", ()=> openDrawer(true));
  els.closeCart.addEventListener("click", ()=> openDrawer(false));
  els.btnCheckout.addEventListener("click", checkoutWhatsApp);

  els.closeModal.addEventListener("click", ()=> closeModal());

  window.__STATE = { products: [], cart: loadCart(), selected: null };

  await loadProducts();
  renderProducts();
  updateCartUI();

  async function loadProducts(){
    const snap = await db.collection("products").orderBy("createdAt","desc").get().catch(()=>null);
    if(!snap){ window.__STATE.products = seedFallback(); return; }
    const list = [];
    snap.forEach(doc=>{
      const d = doc.data();
      list.push({
        id: doc.id,
        name: d.name, brand: d.brand, price: d.price,
        ml: d.ml, notes: d.notes, category: d.category || "",
        image: d.image || "", featured: !!d.featured, stock: d.stock ?? 0,
        createdAt: d.createdAt?.toDate?.() || new Date()
      });
    });
    window.__STATE.products = list.length ? list : seedFallback();
  }

  function renderProducts(){
    const q = els.q.value?.trim().toLowerCase();
    const cat = els.filterCategory.value;
    const sort = els.filterSort.value;

    let items = [...window.__STATE.products];
    if(q){
      items = items.filter(p =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q) ||
        (p.notes || "").toLowerCase().includes(q)
      );
    }
    if(cat){ items = items.filter(p => (p.category||"") === cat); }
    if(sort === "price_asc") items.sort((a,b)=> a.price - b.price);
    if(sort === "price_desc") items.sort((a,b)=> b.price - a.price);
    if(sort === "newest") items.sort((a,b)=> b.createdAt - a.createdAt);
    if(sort === "featured") items.sort((a,b)=> (b.featured?1:0) - (a.featured?1:0));

    els.grid.innerHTML = "";
    if(!items.length){
      els.empty.classList.remove("hidden");
      return;
    }
    els.empty.classList.add("hidden");

    for(const p of items){
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <img src="${sanitizeImg(p.image)}" alt="${escapeHtml(p.name)}" onerror="this.src='https://picsum.photos/seed/perfume${Math.floor(Math.random()*1000)}/600/400'">
        <div class="pad">
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="brand">${escapeHtml(p.brand || "")}</div>
          <div class="price-row">
            <strong>${formatBRL(p.price)}</strong>
            <span class="chip">${p.ml || ""}</span>
          </div>
          <div class="row gap" style="margin-top:10px">
            <button class="btn add">Adicionar</button>
            <button class="btn ghost more">Ver</button>
          </div>
        </div>
      `;
      card.querySelector(".add").addEventListener("click", ()=> addToCart(p));
      card.querySelector(".more").addEventListener("click", ()=> openModal(p));
      els.grid.appendChild(card);
    }
  }

  function openDrawer(show){
    els.cartDrawer.classList.toggle("hidden", !show);
    els.cartDrawer.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function openModal(p){
    window.__STATE.selected = p;
    els.pmImg.src = sanitizeImg(p.image);
    els.pmImg.onerror = ()=> (els.pmImg.src = `https://picsum.photos/seed/perfume${Math.floor(Math.random()*1000)}/600/400`);
    els.pmName.textContent = p.name;
    els.pmBrand.textContent = p.brand || "";
    els.pmNotes.textContent = p.notes || "";
    els.pmPrice.textContent = formatBRL(p.price);
    els.pmMl.textContent = p.ml || "";
    els.pmAdd.onclick = ()=> addToCart(p, 1, true);
    els.pmFav.onclick = ()=> toggleFav(p);
    els.productModal.showModal();
  }
  function closeModal(){ els.productModal.close(); }

  function toggleFav(p){
    const favs = new Set(JSON.parse(localStorage.getItem("favs")||"[]"));
    if(favs.has(p.id)) favs.delete(p.id); else favs.add(p.id);
    localStorage.setItem("favs", JSON.stringify([...favs]));
    alert("Favoritos atualizados ✨");
  }

  function addToCart(p, qty=1, close=true){
    const cart = window.__STATE.cart;
    const idx = cart.findIndex(i=> i.id===p.id);
    if(idx>=0) cart[idx].qty += qty; else cart.push({id:p.id,name:p.name,price:p.price,img:p.image,qty,ml:p.ml});
    saveCart(cart);
    updateCartUI();
    openDrawer(true);
    if(close) closeModal();
  }

  function updateCartUI(){
    const cart = window.__STATE.cart;
    els.cartItems.innerHTML = "";
    let total = 0, count = 0;
    for(const item of cart){
      total += item.price * item.qty;
      count += item.qty;
      const row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML = `
        <img src="${sanitizeImg(item.img)}" alt="">
        <div>
          <div style="font-weight:600">${escapeHtml(item.name)}</div>
          <div class="muted">${item.ml||""}</div>
          <div class="muted">${formatBRL(item.price)}</div>
        </div>
        <div class="qty">
          <button aria-label="Diminuir">-</button>
          <span>${item.qty}</span>
          <button aria-label="Aumentar">+</button>
          <button aria-label="Remover" title="Remover" style="margin-left:4px">🗑️</button>
        </div>
      `;
      const [btnMinus, , btnPlus, btnDel] = row.querySelectorAll("button");
      btnMinus.onclick = ()=> changeQty(item.id, -1);
      btnPlus.onclick = ()=> changeQty(item.id, +1);
      btnDel.onclick  = ()=> removeItem(item.id);
      els.cartItems.appendChild(row);
    }
    els.cartTotal.textContent = formatBRL(total);
    els.cartCount.textContent = count;
  }

  function changeQty(id, delta){
    const cart = window.__STATE.cart;
    const it = cart.find(i=>i.id===id);
    if(!it) return;
    it.qty += delta;
    if(it.qty<=0) window.__STATE.cart = cart.filter(i=>i.id!==id);
    saveCart(window.__STATE.cart);
    updateCartUI();
  }
  function removeItem(id){
    window.__STATE.cart = window.__STATE.cart.filter(i=>i.id!==id);
    saveCart(window.__STATE.cart); updateCartUI();
  }

  function checkoutWhatsApp(){
    const cart = window.__STATE.cart;
    if(!cart.length){ alert("Seu carrinho está vazio."); return; }
    const total = cart.reduce((s,i)=> s+i.price*i.qty, 0);
    const lines = cart.map(i=> `• ${i.name} (${i.ml||""}) x${i.qty} — ${formatBRL(i.price*i.qty)}`);
    lines.push(`\nTotal: *${formatBRL(total)}*`);
    const msg = encodeURIComponent(`Olá! Quero finalizar meu pedido:\n\n${lines.join("\n")}\n\nNome:\nCEP:\nForma de pagamento: Pix / Cartão / Dinheiro`);
    const url = `https://wa.me/${WHATSAPP_PHONE}?text=${msg}`;
    window.open(url, "_blank");
  }

  function loadCart(){ try{return JSON.parse(localStorage.getItem("cart")||"[]");}catch{ return [] } }
  function saveCart(v){ localStorage.setItem("cart", JSON.stringify(v)); }
  function byId(id){ return document.getElementById(id); }
  function formatBRL(n){ return n?.toLocaleString?.("pt-BR",{style:"currency",currency:"BRL"}) ?? "R$ 0,00"; }
  function sanitizeImg(src){ return src || "https://picsum.photos/seed/duoparfum/600/400"; }
  function escapeHtml(s=""){ return s.replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

  function seedFallback(){
    const now = new Date();
    return [
      {id:"1",name:"La Vie Est Belle",brand:"Lancôme",price:549.9,ml:"100 ml",notes:"Gourmand floral com íris e patchouli.",category:"Importado",image:"",featured:true,stock:8,createdAt:now},
      {id:"2",name:"Good Girl",brand:"Carolina Herrera",price:589.9,ml:"80 ml",notes:"Doce oriental com jasmim e fava tonka.",category:"Importado",image:"",featured:true,stock:5,createdAt:now},
      {id:"3",name:"212 VIP Men",brand:"Carolina Herrera",price:479.9,ml:"100 ml",notes:"Amadeirado especiado com rum e couro.",category:"Importado",image:"",featured:false,stock:7,createdAt:now},
      {id:"4",name:"Quasar",brand:"O Boticário",price:169.9,ml:"100 ml",notes:"Aromático fresco, versátil.",category:"Nacional",image:"",featured:false,stock:12,createdAt:now},
      {id:"5",name:"Decant Sauvage",brand:"Dior",price:59.9,ml:"10 ml",notes:"Cítrico aromático, ambroxan.",category:"Decant",image:"",featured:true,stock:30,createdAt:now},
      {id:"6",name:"Decant Bleu de Chanel",brand:"Chanel",price:69.9,ml:"10 ml",notes:"Amadeirado cítrico, incenso.",category:"Decant",image:"",featured:false,stock:22,createdAt:now}
    ]
  }
});
