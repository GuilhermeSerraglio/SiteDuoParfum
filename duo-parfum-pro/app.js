/* ========= CONFIG FIREBASE ========= */
const firebaseConfig = window.firebaseConfig || {
  apiKey: "AIzaSyDVkpsr4z6LolEOkNTGcc9TmKeiu4-mi1Y",
  authDomain: "duoparfum-61ec2.firebaseapp.com",
  projectId: "duoparfum-61ec2",
  storageBucket: "duoparfum-61ec2.firebasestorage.app",
  messagingSenderId: "889684986920",
  appId: "1:889684986920:web:9d452daf2192124b19391d"
};
const ADMIN_EMAILS = ["guilhermeserraglio03@gmail.com"];
/* =================================== */

let app, db, auth;

document.addEventListener("DOMContentLoaded", async () => {
  app = firebase.apps?.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();

  const els = mapIds([
    "grid","emptyState","q","btnSearch","filterCategory","filterSort","btnClearFilters",
    "btnCart","cartDrawer","closeCart","cartItems","cartTotal","cartCount","btnCheckout",
    "btnLogin","btnLogout","linkAdmin",
    "productModal","pmImg","pmName","pmBrand","pmNotes","pmPrice","pmMl","pmAdd","pmFav","closeModal",
    "checkoutModal","closeCheckout","ckName","ckEmail","ckCep","ckAddress","ckPayment","ckConfirm","paymentArea","year"
  ]);

  if (els.year) els.year.textContent = new Date().getFullYear();

  /* ==== Auth ==== */
  auth.onAuthStateChanged(user => {
    const logged = !!user;
    if (els.btnLogin) toggle(els.btnLogin, logged);
    if (els.btnLogout) toggle(els.btnLogout, !logged);
    if (els.linkAdmin) toggle(els.linkAdmin, !(logged && ADMIN_EMAILS.includes(user?.email)));
  });

  if (els.btnLogin) {
    els.btnLogin.onclick = async ()=>{
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    };
  }
  if (els.btnLogout) els.btnLogout.onclick = ()=> auth.signOut();

  /* ==== Filtros ==== */
  if (els.btnSearch) els.btnSearch.onclick = renderProducts;
  if (els.filterCategory) els.filterCategory.onchange = renderProducts;
  if (els.filterSort) els.filterSort.onchange = renderProducts;
  if (els.btnClearFilters) {
    els.btnClearFilters.onclick = ()=>{
      if (els.q) els.q.value="";
      if (els.filterCategory) els.filterCategory.value="";
      if (els.filterSort) els.filterSort.value="featured";
      renderProducts();
    };
  }

  /* ==== Carrinho ==== */
  if (els.btnCart) els.btnCart.onclick = ()=> openDrawer(true);
  if (els.closeCart) els.closeCart.onclick = ()=> openDrawer(false);
  if (els.btnCheckout) {
    els.btnCheckout.onclick = ()=>{
      if(!state.cart.length){ alert("Seu carrinho está vazio."); return; }
      resetCheckoutModal();
      openDrawer(false);
      els.checkoutModal?.showModal();
    };
  }
  if (els.closeCheckout) els.closeCheckout.onclick = ()=> els.checkoutModal?.close();
  if (els.checkoutModal) els.checkoutModal.addEventListener("close", ()=>{
    resetCheckoutModal();
    openDrawer(false);
  });

  if (els.closeModal) els.closeModal.onclick = ()=> closeModal();
  if (els.ckConfirm) els.ckConfirm.onclick = confirmCheckout;

  /* ==== State ==== */
  const state = window.__STATE = { products: [], cart: loadCart(), selected: null, processingCheckout:false };

  await loadProducts();
  renderProducts();
  updateCartUI();

  /* ==== Funções ==== */
  async function loadProducts(){
    try {
      const snap = await db.collection("products").orderBy("createdAt","desc").get();
      const list=[];
      snap.forEach(doc=>{
        const d=doc.data();
        list.push({
          id:doc.id,
          name:d.name,brand:d.brand,price:d.price,
          ml:d.ml,notes:d.notes,category:d.category||"",
          image:d.image||"",featured:!!d.featured,stock:d.stock??0,
          createdAt:d.createdAt?.toDate?.()||new Date()
        });
      });
      state.products=list;
    } catch(e){
      console.error("Erro ao carregar produtos:", e);
      state.products=[];
    }
  }

  function renderProducts(){
    const q=els.q?.value?.trim().toLowerCase();
    const cat=els.filterCategory?.value;
    const sort=els.filterSort?.value;

    let items=[...state.products];
    if(q) items=items.filter(p=> (p.name||"").toLowerCase().includes(q) || (p.brand||"").toLowerCase().includes(q) || (p.notes||"").toLowerCase().includes(q));
    if(cat) items=items.filter(p=> (p.category||"")===cat);
    if(sort==="price_asc") items.sort((a,b)=>a.price-b.price);
    if(sort==="price_desc") items.sort((a,b)=>b.price-a.price);
    if(sort==="newest") items.sort((a,b)=>b.createdAt-a.createdAt);
    if(sort==="featured") items.sort((a,b)=>(b.featured?1:0)-(a.featured?1:0));

    if (els.grid) els.grid.innerHTML="";
    if(!items.length){ els.emptyState?.classList.remove("hidden"); return; }
    els.emptyState?.classList.add("hidden");

    for(const p of items){
      const card=document.createElement("article");
      card.className="card";
      card.innerHTML=`
        <img src="${sanitizeImg(p.image)}" alt="${escapeHtml(p.name)}">
        <div class="pad">
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="brand">${escapeHtml(p.brand||"")}</div>
          <div class="price-row">
            <strong>${formatBRL(p.price)}</strong>
            <span class="chip">${p.ml||""}</span>
          </div>
          <div class="row gap" style="margin-top:10px">
            <button class="btn add-to-cart">Adicionar</button>
            <button class="btn ghost more">Ver</button>
          </div>
        </div>`;
      card.querySelector(".add-to-cart").onclick=()=> addToCart(p);
      card.querySelector(".more").onclick=()=> openModal(p);
      els.grid.appendChild(card);
    }
  }

  function openDrawer(show){
    if(!els.cartDrawer) return;
    els.cartDrawer.classList.toggle("hidden", !show);
    els.cartDrawer.setAttribute("aria-hidden", show?"false":"true");
  }
  function openModal(p){
    state.selected=p;
    if (els.pmImg) els.pmImg.src=sanitizeImg(p.image);
    if (els.pmName) els.pmName.textContent=p.name;
    if (els.pmBrand) els.pmBrand.textContent=p.brand||"";
    if (els.pmNotes) els.pmNotes.textContent=p.notes||"";
    if (els.pmPrice) els.pmPrice.textContent=formatBRL(p.price);
    if (els.pmMl) els.pmMl.textContent=p.ml||"";
    if (els.pmAdd) els.pmAdd.onclick=()=> addToCart(p,1,true);
    if (els.pmFav) els.pmFav.onclick=()=> toggleFav(p);
    els.productModal?.showModal();
  }
  function closeModal(){ els.productModal?.close(); }
  function toggleFav(p){
    const favs=new Set(JSON.parse(localStorage.getItem("favs")||"[]"));
    if(favs.has(p.id)) favs.delete(p.id); else favs.add(p.id);
    localStorage.setItem("favs", JSON.stringify([...favs]));
    alert("Favoritos atualizados ✨");
  }

  function addToCart(p,qty=1,close=true){
    const cart=state.cart;
    const idx=cart.findIndex(i=>i.id===p.id);
    if(idx>=0) cart[idx].qty+=qty; else cart.push({id:p.id,name:p.name,price:p.price,img:p.image,qty,ml:p.ml});
    saveCart(cart); updateCartUI(); openDrawer(true); if(close) closeModal();
  }
  function changeQty(id,delta){
    const it=state.cart.find(i=>i.id===id); if(!it) return;
    it.qty+=delta; if(it.qty<=0) state.cart=state.cart.filter(i=>i.id!==id);
    saveCart(state.cart); updateCartUI();
  }
  function removeItem(id){ state.cart=state.cart.filter(i=>i.id!==id); saveCart(state.cart); updateCartUI(); }

  function updateCartUI(){
    if (!els.cartItems) return;
    els.cartItems.innerHTML=""; let total=0,count=0;
    for(const item of state.cart){
      total+=item.price*item.qty; count+=item.qty;
      const row=document.createElement("div"); row.className="cart-item";
      row.innerHTML=`
        <img src="${sanitizeImg(item.img)}" alt="">
        <div>
          <div style="font-weight:600">${escapeHtml(item.name)}</div>
          <div class="muted">${item.ml||""}</div>
          <div class="muted">${formatBRL(item.price)}</div>
        </div>
        <div class="qty">
          <button>-</button>
          <span>${item.qty}</span>
          <button>+</button>
          <button title="Remover">🗑️</button>
        </div>`;
      const [btnMinus,btnPlus,btnDel]=row.querySelectorAll("button");
      btnMinus?.addEventListener("click",()=>changeQty(item.id,-1));
      btnPlus?.addEventListener("click",()=>changeQty(item.id,1));
      btnDel?.addEventListener("click",()=>removeItem(item.id));
      els.cartItems.appendChild(row);
    }
    if (els.cartTotal) els.cartTotal.textContent=formatBRL(total);
    if (els.cartCount) els.cartCount.textContent=count;
  }

  async function confirmCheckout(){
    if(state.processingCheckout) return;
    const name=(els.ckName?.value||"").trim();
    const email=(els.ckEmail?.value||"").trim().toLowerCase();
    const cep=(els.ckCep?.value||"").trim();
    const address=(els.ckAddress?.value||"").trim();
    const payment=els.ckPayment?.value;
    if(!name||!email||!cep||!address){ alert("Preencha todos os campos."); return; }
    if(!isValidEmail(email)){ alert("Informe um e-mail válido."); return; }
    if(!state.cart.length){ alert("Carrinho vazio."); return; }

    setCheckoutProcessing(true);
    if (els.paymentArea) els.paymentArea.innerHTML="<p class=\"muted\">Gerando pagamento...</p>";

    const total=state.cart.reduce((s,i)=>s+i.price*i.qty,0);
    const order={
      items: state.cart.map(i=>({id:i.id,name:i.name,ml:i.ml||"",price:i.price,qty:i.qty})),
      total,
      createdAt:new Date(),
      status:"pending",
      customer:{name,email,cep,address,payment}
    };

    let orderId="";
    try{
      const ref=await db.collection("orders").add(order);
      orderId=ref.id;
    }catch(e){
      console.error(e);
      alert("Erro ao salvar pedido.");
      setCheckoutProcessing(false);
      return;
    }

    let success=false;
    try{
      const resp=await fetch("/api/payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId,order})});
      if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data=await resp.json();
      if(data.error) throw new Error(data.error);

      if(payment==="pix"){
        if(els.paymentArea){
          const pixParts=["<p>Escaneie o QRCode para pagar:</p>"];
          if(data.qr){
            pixParts.push(`<img src="data:image/png;base64,${data.qr}" style="max-width:200px">`);
          }else{
            pixParts.push("<p class=\"muted\">QRCode indisponível. Utilize o código abaixo para concluir o pagamento.</p>");
          }
          if(data.code){
            pixParts.push("<p>Código Copia e Cola:</p>");
            pixParts.push(`<textarea readonly style="width:100%">${escapeHtml(data.code)}</textarea>`);
          }else{
            pixParts.push("<p class=\"muted\">Código PIX não retornado. Entre em contato com o atendimento.</p>");
          }
          els.paymentArea.innerHTML=pixParts.join("\n");
        }
      }else if(payment==="card"){
        if(els.paymentArea) els.paymentArea.innerHTML=`<a href="${data.link}" target="_blank" class="btn">Pagar com cartão</a>`;
      }
      if (els.paymentArea) els.paymentArea.insertAdjacentHTML("beforeend","<p class=\"muted\" style=\"margin-top:12px\">Pedido registrado com sucesso. Utilize o pagamento acima para concluir sua compra.</p>");
      state.cart=[];
      saveCart(state.cart);
      updateCartUI();
      openDrawer(false);
      markCheckoutCompleted();
      success=true;
    }catch(e){
      console.error(e);
      alert("Erro ao gerar pagamento.");
      if(orderId){
        try{ await db.collection("orders").doc(orderId).delete(); }catch(err){ console.error("Falha ao remover pedido pendente:", err); }
      }
    }finally{
      if(!success) setCheckoutProcessing(false);
    }
  }

  function setCheckoutProcessing(active){
    state.processingCheckout=active;
    if(els.ckConfirm){
      els.ckConfirm.disabled=active;
      els.ckConfirm.textContent=active?"Gerando...":"Gerar pagamento";
    }
  }

  function markCheckoutCompleted(){
    state.processingCheckout=false;
    if(els.ckConfirm){
      els.ckConfirm.disabled=true;
      els.ckConfirm.textContent="Pagamento gerado";
    }
  }

  function resetCheckoutModal(){
    state.processingCheckout=false;
    if(els.ckConfirm){
      els.ckConfirm.disabled=false;
      els.ckConfirm.textContent="Gerar pagamento";
    }
    if(els.paymentArea) els.paymentArea.innerHTML="";
  }

  /* ==== Helpers ==== */
  function mapIds(ids){const o={};ids.forEach(id=>o[id]=document.getElementById(id));return o;}
  function toggle(el,h){if(el) el.classList.toggle("hidden",h);}
  function loadCart(){try{return JSON.parse(localStorage.getItem("cart")||"[]");}catch{return []}}
  function saveCart(v){localStorage.setItem("cart",JSON.stringify(v));}
  function formatBRL(n){return n?.toLocaleString?.("pt-BR",{style:"currency",currency:"BRL"})??"R$ 0,00";}
  function sanitizeImg(src){return src||"https://picsum.photos/seed/duoparfum/600/400";}
  function isValidEmail(email=""){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
  function escapeHtml(s=""){return s.replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
});
