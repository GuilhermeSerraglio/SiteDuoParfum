/* ========= CONFIG FIREBASE ========= */
const firebaseConfig = window.firebaseConfig || {
  apiKey: "AIzaSyDVkpsr4z6LolEOkNTGcc9TmKeiu4-mi1Y",
  authDomain: "duoparfum-61ec2.firebaseapp.com",
  projectId: "duoparfum-61ec2",
  storageBucket: "duoparfum-61ec2.firebasestorage.app",
  messagingSenderId: "889684986920",
  appId: "1:889684986920:web:9d452daf2192124b19391d"
};
const ADMIN_EMAILS = [
  "guilhermeserraglio03@gmail.com",
  "guilhermeserraglio@gmail.com",
];
const ORDER_STATUS = {
  pending: { key: "pending", label: "Pendente", className: "is-pending", description: "Aguardando confirmação de pagamento" },
  paid: { key: "paid", label: "Pago", className: "is-paid", description: "Pagamento confirmado" },
  sent: { key: "sent", label: "Enviado", className: "is-sent", description: "Pedido enviado para entrega" },
  canceled: { key: "canceled", label: "Cancelado", className: "is-canceled", description: "Pagamento cancelado ou não aprovado" }
};
/* =================================== */

let app, db, auth;

document.addEventListener("DOMContentLoaded", async () => {
  app = firebase.apps?.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();

  const els = mapIds([
    "grid","emptyState","q","btnSearch","filterCategory","filterSort","btnClearFilters",
    "btnCart","cartDrawer","closeCart","cartItems","cartTotal","cartCount","btnCheckout",
    "btnLogin","btnLogout","linkAdmin","linkOrders","ordersSection","ordersList","ordersEmpty","ordersLoading","ordersGuest","ordersError",
    "productModal","pmImg","pmName","pmBrand","pmNotes","pmPrice","pmMl","pmAdd","pmFav","closeModal",
    "checkoutModal","closeCheckout","ckName","ckEmail","ckCep","ckAddress","ckPayment","ckConfirm","paymentArea","year"
  ]);

  if (els.year) els.year.textContent = new Date().getFullYear();

  initHeroSlider();

  /* ==== Auth ==== */
  auth.onAuthStateChanged(user => {
    const logged = !!user;
    if (els.btnLogin) toggle(els.btnLogin, logged);
    if (els.btnLogout) toggle(els.btnLogout, !logged);
    if (els.linkAdmin) toggle(els.linkAdmin, !(logged && ADMIN_EMAILS.includes(user?.email)));
    if (els.linkOrders) toggle(els.linkOrders, !logged);

    if (!logged) {
      cleanupOrderListeners();
      stopCheckoutOrderListener();
      state.orders = [];
      state.orderTracking = {};
      state.ordersError = "";
      state.ordersLoading = false;
      state.checkoutOrderId = "";
    }

    renderOrders();

    if (logged) {
      loadUserOrders(user);
    }
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
  if (els.ordersList) {
    els.ordersList.addEventListener("click", ev => {
      const btn = ev.target?.closest?.("[data-refresh-tracking]");
      if (!btn) return;
      const orderId = btn.getAttribute("data-refresh-tracking");
      if (!orderId) return;
      const order = state.orders.find(o => o.id === orderId);
      if (!order || !order.trackingCode) return;
      requestTracking(order, true);
    });
  }

  /* ==== State ==== */
  const state = window.__STATE = {
    products: [],
    cart: loadCart(),
    selected: null,
    processingCheckout: false,
    orders: [],
    orderTracking: {},
    ordersLoading: false,
    ordersError: "",
    checkoutOrderId: ""
  };

  let orderUnsubscribes = [];
  let orderDocSources = new Map();
  let orderDocs = new Map();
  let orderPendingKeys = new Set();
  let checkoutOrderUnsubscribe = null;

  await loadProducts();
  renderProducts();
  updateCartUI();
  renderOrders();

  /* ==== Funções ==== */
  function initHeroSlider() {
    const root = document.querySelector(".hero-slider");
    if (!root) return;

    const slides = Array.from(root.querySelectorAll(".hero-slide"));
    const dots = Array.from(root.querySelectorAll(".hero-slider-dot"));

    if (!slides.length || slides.length !== dots.length) return;

    let activeIndex = slides.findIndex(slide => slide.classList.contains("is-active"));
    activeIndex = activeIndex >= 0 ? activeIndex : 0;
    let timerId = null;
    const INTERVAL = 6000;

    const setActive = index => {
      const nextIndex = (index + slides.length) % slides.length;
      activeIndex = nextIndex;
      slides.forEach((slide, idx) => {
        slide.classList.toggle("is-active", idx === nextIndex);
      });
      dots.forEach((dot, idx) => {
        const isCurrent = idx === nextIndex;
        dot.classList.toggle("is-active", isCurrent);
        dot.setAttribute("aria-pressed", isCurrent ? "true" : "false");
      });
    };

    const stop = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const start = () => {
      stop();
      timerId = setInterval(() => {
        setActive(activeIndex + 1);
      }, INTERVAL);
    };

    dots.forEach((dot, idx) => {
      dot.addEventListener("click", () => {
        setActive(idx);
        start();
      });
    });

    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", start);
    root.addEventListener("focusin", stop);
    root.addEventListener("focusout", start);

    setActive(activeIndex);
    start();
  }

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
      userId: auth.currentUser?.uid || null,
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
      state.checkoutOrderId = orderId;
      listenToCheckoutOrder(orderId);
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

  function listenToCheckoutOrder(orderId){
    stopCheckoutOrderListener();
    if(!orderId||!db){
      renderCheckoutPaymentStatusError("Não foi possível monitorar o status do pagamento automaticamente. Consulte a área de pedidos para mais detalhes.");
      return;
    }
    state.checkoutOrderId=orderId;
    renderCheckoutPaymentStatusBanner(ORDER_STATUS.pending);
    try{
      checkoutOrderUnsubscribe=db.collection("orders").doc(orderId).onSnapshot(doc=>{
        if(!doc.exists) return;
        const order=mapOrderDocument(doc);
        applyCheckoutPaymentStatus(order);
      },err=>{
        console.error("Erro ao acompanhar status do pagamento:", err);
        renderCheckoutPaymentStatusError("Não foi possível atualizar o status do pagamento automaticamente. Atualize a página para verificar novamente.");
      });
    }catch(err){
      console.error("Erro ao iniciar acompanhamento do pagamento:", err);
      renderCheckoutPaymentStatusError("Não foi possível monitorar o status do pagamento automaticamente. Atualize a página para acompanhar o pedido.");
    }
  }

  function applyCheckoutPaymentStatus(order){
    if(!order) return;
    const statusInfo=getOrderStatusInfo(order.status);
    renderCheckoutPaymentStatusBanner(statusInfo);
    if(statusInfo.key===ORDER_STATUS.paid.key||statusInfo.key===ORDER_STATUS.canceled.key){
      stopCheckoutOrderListener({preserveStatus:true});
    }
  }

  function renderCheckoutPaymentStatusBanner(statusInfo){
    if(!els.paymentArea||!statusInfo) return;
    const classes=["payment-status-banner"];
    if(statusInfo.className) classes.push(statusInfo.className);
    const html=`<div class="${classes.join(" ")}" data-payment-status>
      <strong>Status do pagamento</strong>
      <span>${escapeHtml(statusInfo.description||"")}</span>
    </div>`;
    const existing=els.paymentArea.querySelector("[data-payment-status]");
    if(existing){
      existing.outerHTML=html;
    }else{
      els.paymentArea.insertAdjacentHTML("afterbegin",html);
    }
  }

  function renderCheckoutPaymentStatusError(message){
    if(!els.paymentArea) return;
    const html=`<div class="payment-status-banner is-error" data-payment-status>
      <strong>Status do pagamento</strong>
      <span>${escapeHtml(message||"Não foi possível confirmar o status do pagamento automaticamente.")}</span>
    </div>`;
    const existing=els.paymentArea.querySelector("[data-payment-status]");
    if(existing){
      existing.outerHTML=html;
    }else{
      els.paymentArea.insertAdjacentHTML("afterbegin",html);
    }
  }

  function stopCheckoutOrderListener(options={}){
    const {preserveStatus=false}=options;
    if(typeof checkoutOrderUnsubscribe==="function"){
      try{ checkoutOrderUnsubscribe(); }catch(err){ console.warn("Falha ao remover listener de checkout:", err); }
    }
    checkoutOrderUnsubscribe=null;
    state.checkoutOrderId="";
    if(!preserveStatus&&els.paymentArea){
      const banner=els.paymentArea.querySelector("[data-payment-status]");
      if(banner) banner.remove();
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
    stopCheckoutOrderListener();
    if(els.paymentArea) els.paymentArea.innerHTML="";
  }

  /* ==== Pedidos ==== */
  function cleanupOrderListeners(){
    if (orderUnsubscribes.length){
      orderUnsubscribes.forEach(unsub=>{
        try{ unsub?.(); }catch(err){ console.warn("Falha ao remover listener de pedidos:", err); }
      });
    }
    orderUnsubscribes=[];
    orderDocSources=new Map();
    orderDocs=new Map();
    orderPendingKeys=new Set();
  }

  function loadUserOrders(user){
    cleanupOrderListeners();

    state.orders=[];
    state.ordersLoading=true;
    state.ordersError="";
    state.orderTracking={};
    orderDocs=new Map();
    orderDocSources=new Map();
    renderOrders();

    if(!user){
      state.ordersLoading=false;
      renderOrders();
      return;
    }

    const email=(user.email||"").trim().toLowerCase();
    const queries=[];
    if(user.uid){
      queries.push({key:`uid:${user.uid}`,query:db.collection("orders").where("userId","==",user.uid)});
    }
    if(email){
      queries.push({key:`email:${email}`,query:db.collection("orders").where("customer.email","==",email)});
    }

    if(!queries.length){
      state.ordersLoading=false;
      renderOrders();
      return;
    }

    orderPendingKeys=new Set(queries.map(q=>q.key));

    queries.forEach(({key,query})=>{
      const unsub=query.onSnapshot(snapshot=>{
        orderPendingKeys.delete(key);

        snapshot.docChanges().forEach(change=>{
          const docId=change.doc.id;
          if(change.type==="removed"){
            const sources=orderDocSources.get(docId);
            if(sources){
              sources.delete(key);
              if(!sources.size){
                orderDocSources.delete(docId);
                orderDocs.delete(docId);
              }
            }
            return;
          }

          let sources=orderDocSources.get(docId);
          if(!sources){
            sources=new Set();
            orderDocSources.set(docId,sources);
          }
          sources.add(key);
          orderDocs.set(docId,change.doc);
        });

        updateOrdersFromAggregated();
      },err=>{
        console.error("Erro ao carregar pedidos:", err);
        cleanupOrderListeners();
        state.ordersError="Não foi possível carregar seus pedidos. Tente novamente mais tarde.";
        state.ordersLoading=false;
        renderOrders();
      });
      orderUnsubscribes.push(unsub);
    });
  }

  function updateOrdersFromAggregated(){
    const orders=[];
    orderDocs.forEach(doc=>{
      orders.push(mapOrderDocument(doc));
    });
    orders.sort((a,b)=>(b.createdAt?.getTime?.()||0)-(a.createdAt?.getTime?.()||0));

    const prevTracking=state.orderTracking||{};
    const nextTracking={};
    for(const order of orders){
      const prev=prevTracking[order.id];
      if(prev && prev.code===order.trackingCode){
        nextTracking[order.id]=prev;
      }
    }

    state.orderTracking=nextTracking;
    state.orders=orders;
    state.ordersError="";
    state.ordersLoading=orderPendingKeys.size>0;
    renderOrders();
  }

  function renderOrders(){
    if(!els.ordersSection) return;

    const logged=!!auth.currentUser;
    if(els.ordersGuest) toggle(els.ordersGuest, logged);

    if(els.ordersError){
      if(state.ordersError){
        els.ordersError.textContent=state.ordersError;
        toggle(els.ordersError,false);
      }else{
        els.ordersError.textContent="";
        toggle(els.ordersError,true);
      }
    }

    if(!logged){
      if(els.ordersLoading) toggle(els.ordersLoading,true);
      if(els.ordersEmpty) toggle(els.ordersEmpty,true);
      if(els.ordersList){
        els.ordersList.innerHTML="";
        toggle(els.ordersList,true);
      }
      return;
    }

    if(state.ordersError){
      if(els.ordersLoading) toggle(els.ordersLoading,true);
      if(els.ordersEmpty) toggle(els.ordersEmpty,true);
      if(els.ordersList){
        els.ordersList.innerHTML="";
        toggle(els.ordersList,true);
      }
      return;
    }

    if(state.ordersLoading){
      if(els.ordersLoading) toggle(els.ordersLoading,false);
      if(els.ordersEmpty) toggle(els.ordersEmpty,true);
      if(els.ordersList) toggle(els.ordersList,true);
      return;
    }

    if(els.ordersLoading) toggle(els.ordersLoading,true);

    const hasOrders=state.orders.length>0;
    if(els.ordersEmpty) toggle(els.ordersEmpty, hasOrders);

    if(!els.ordersList) return;
    toggle(els.ordersList,!hasOrders);
    els.ordersList.innerHTML="";
    if(!hasOrders) return;

    state.orders.forEach(order=>{
      const card=renderOrderCard(order);
      if(!card) return;
      els.ordersList.appendChild(card);
      if(order.trackingCode){
        requestTracking(order);
      }else{
        state.orderTracking[order.id]=null;
        updateTrackingUI(order.id);
      }
    });
  }

  function renderOrderCard(order){
    if(!order) return null;
    const statusInfo=getOrderStatusInfo(order.status);
    const card=document.createElement("article");
    card.className=`card order-card ${statusInfo.className}`;

    const friendlyId=order.id?order.id.slice(-6).toUpperCase():"000000";
    const createdAtText=formatOrderDate(order.createdAt);
    const customer=order.customer||{};
    const destination=[customer.address,customer.cep].filter(Boolean).join(" · ");

    const metaLines=[];
    if(createdAtText) metaLines.push(`Realizado em ${createdAtText}`);
    if(destination) metaLines.push(destination);

    const items=Array.isArray(order.items)?order.items:[];
    const itemsHtml=items.map(item=>{
      const qty=Math.max(1, Number(item?.qty)||1);
      const name=escapeHtml(item?.name||"Item");
      const ml=item?.ml?` (${escapeHtml(item.ml)})`:"";
      return `<li>${qty}x ${name}${ml}</li>`;
    }).join("");

    const trackingSection=order.trackingCode
      ? `<div class="order-tracking" data-order-id="${order.id}">
          <div class="order-tracking__code">Código: <strong>${escapeHtml(order.trackingCode)}</strong></div>
          <div class="order-tracking__status" data-tracking-status="${order.id}">
            <span class="muted">Consultando status nos Correios...</span>
          </div>
          <div class="order-card__tracking-actions">
            <button class="btn small ghost" data-refresh-tracking="${order.id}">Atualizar rastreio</button>
            <a class="btn small ghost" href="https://rastreamento.correios.com.br/app/index.php?codigo=${encodeURIComponent(order.trackingCode)}" target="_blank" rel="noreferrer">Ver no site dos Correios</a>
          </div>
        </div>`
      : `<p class="muted">O código de rastreio será informado assim que o pedido for postado.</p>`;

    card.innerHTML=`
      <div class="pad order-card__content">
        <div class="order-card__header">
          <div>
            <p class="order-card__title">Pedido #${escapeHtml(friendlyId)}</p>
            ${metaLines.map(line=>`<p class="order-card__meta-line">${escapeHtml(line)}</p>`).join("")}
          </div>
          <span class="order-card__status-badge ${statusInfo.className}">${statusInfo.label}</span>
        </div>
        <div class="order-card__details">
          <div>
            <span class="order-card__label">Status do pedido</span>
            <span class="order-card__value">${escapeHtml(statusInfo.description)}</span>
          </div>
          <div>
            <span class="order-card__label">Pagamento</span>
            <span class="order-card__value">${escapeHtml(customer.payment||"Não informado")}</span>
          </div>
          <div>
            <span class="order-card__label">Total</span>
            <span class="order-card__value">${formatBRL(order.total)}</span>
          </div>
        </div>
        <div class="order-card__items">
          <span class="order-card__label">Itens</span>
          <ul>${itemsHtml||"<li class='muted'>Nenhum item registrado.</li>"}</ul>
        </div>
        <div class="order-card__tracking">
          <span class="order-card__label">Envio e rastreio</span>
          ${trackingSection}
        </div>
      </div>`;
    return card;
  }

  function requestTracking(order,force=false){
    const code=sanitizeTrackingCode(order?.trackingCode||"");
    const id=order?.id;
    if(!id||!code){
      if(id){
        state.orderTracking[id]=null;
        updateTrackingUI(id);
      }
      return;
    }
    const existing=state.orderTracking[id];
    if(!force && existing && existing.code===code && (existing.status==="loading"||existing.status==="loaded")){
      updateTrackingUI(id);
      return;
    }
    state.orderTracking[id]={code,status:"loading"};
    updateTrackingUI(id);
    fetchTracking(code)
      .then(data=>{
        state.orderTracking[id]={code,status:"loaded",data,fetchedAt:new Date()};
        updateTrackingUI(id);
      })
      .catch(err=>{
        state.orderTracking[id]={code,status:"error",message:err?.message||"Falha ao consultar rastreio"};
        updateTrackingUI(id);
      });
  }

  async function fetchTracking(code){
    const resp=await fetch(`/api/tracking?code=${encodeURIComponent(code)}`);
    const text=await resp.text();
    let payload={};
    if(text){
      try{ payload=JSON.parse(text); }catch{ payload={}; }
    }
    if(!resp.ok){
      const message=payload?.error||`HTTP ${resp.status}`;
      throw new Error(message);
    }
    if(payload?.error){
      throw new Error(payload.error);
    }
    return payload;
  }

  function updateTrackingUI(orderId){
    if(!orderId||!els.ordersList) return;
    const container=els.ordersList.querySelector(`[data-tracking-status="${orderId}"]`);
    if(!container) return;
    const tracking=state.orderTracking[orderId];
    if(!tracking||!tracking.code){
      container.innerHTML=`<span class="muted">Aguardando código de rastreio.</span>`;
      return;
    }
    if(tracking.status==="loading"){
      container.innerHTML=`<span class="muted">Consultando status nos Correios...</span>`;
      return;
    }
    if(tracking.status==="error"){
      container.innerHTML=`<span class="muted">Não foi possível atualizar o rastreio (${escapeHtml(tracking.message||"Erro desconhecido")}).</span>`;
      return;
    }
    const events=Array.isArray(tracking.data?.events)?tracking.data.events:[];
    if(!events.length){
      container.innerHTML=`<span class="muted">Nenhuma atualização encontrada pelos Correios até o momento.</span>`;
      return;
    }

    const last=events[0]||{};
    const title=escapeHtml(last.status||last.description||"Atualização");
    const momentText=formatTrackingMoment(last);
    const momentHtml=momentText?escapeHtml(momentText):"";
    const locationHtml=last.location?escapeHtml(last.location):"";
    const infoParts=[];
    if(momentHtml) infoParts.push(momentHtml);
    if(locationHtml) infoParts.push(locationHtml);
    const infoLine=infoParts.length?`<span>${infoParts.join(" · ")}</span>`:"";
    const detailsText=last.details&&last.details!==last.description?last.details:last.description;
    const detailsHtml=detailsText?`<p>${escapeHtml(detailsText)}</p>`:"";
    const fetchedHtml=tracking.fetchedAt?`<span class="muted">Atualizado em ${escapeHtml(formatOrderDate(tracking.fetchedAt))}</span>`:"";

    const historyItems=events.map(ev=>{
      const eventTitle=escapeHtml(ev.status||ev.description||"Atualização");
      const eventMoment=formatTrackingMoment(ev);
      const eventMomentHtml=eventMoment?escapeHtml(eventMoment):"";
      const eventLocation=ev.location?escapeHtml(ev.location):"";
      const info=[];
      if(eventMomentHtml) info.push(eventMomentHtml);
      if(eventLocation) info.push(eventLocation);
      const infoHtml=info.length?`<span>${info.join(" · ")}</span>`:"";
      const eventDetails=ev.details&&ev.details!==ev.description?`<div>${escapeHtml(ev.details)}</div>`:"";
      return `<li><strong>${eventTitle}</strong>${infoHtml}${eventDetails}</li>`;
    }).join("");

    container.innerHTML=`
      <div class="order-tracking__event">
        <div class="order-tracking__event-head">
          <strong>${title}</strong>
          ${infoLine}
        </div>
        ${detailsHtml}
        ${fetchedHtml}
      </div>
      ${events.length>1?`<details class="order-tracking__history"><summary>Ver histórico completo</summary><ul>${historyItems}</ul></details>`:""}
    `;
  }

  function formatOrderDate(value){
    if(!value) return "";
    let date=value;
    if(!(date instanceof Date)){
      date=new Date(date);
    }
    if(!(date instanceof Date)||Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
  }

  function formatTrackingMoment(ev={}){
    if(ev.timestamp){
      const dt=new Date(ev.timestamp);
      if(!Number.isNaN(dt.getTime())){
        return dt.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
      }
    }
    if(ev.date&&ev.time){
      const composed=new Date(`${ev.date}T${ev.time}`);
      if(!Number.isNaN(composed.getTime())){
        return composed.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
      }
      return `${ev.date} ${ev.time}`;
    }
    if(ev.date) return ev.date;
    if(ev.time) return ev.time;
    if(ev.raw?.dtHrCriado){
      const dt=new Date(ev.raw.dtHrCriado);
      if(!Number.isNaN(dt.getTime())){
        return dt.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
      }
    }
    return "";
  }

  function mapOrderDocument(doc){
    if(!doc) return {id:"",status:"pending",items:[],total:0,customer:{},trackingCode:""};
    const data=typeof doc.data==="function"?doc.data():{};
    const createdAt=typeof data?.createdAt?.toDate==="function"?data.createdAt.toDate():data?.createdAt instanceof Date?data.createdAt:null;
    const items=Array.isArray(data?.items)?data.items.map(item=>({
      id:item?.id||"",
      name:item?.name||"",
      ml:item?.ml||"",
      qty:item?.qty||1,
      price:item?.price||0
    })):
    [];
    const customer=data?.customer||{};
    const trackingCode=sanitizeTrackingCode(data?.trackingCode||data?.shipping?.trackingCode||"");
    return {
      id:doc.id,
      status:data?.status||"pending",
      createdAt,
      items,
      total:Number(data?.total)||0,
      customer:{
        name:customer?.name||"",
        email:customer?.email||"",
        cep:customer?.cep||"",
        address:customer?.address||"",
        payment:customer?.payment||"",
        phone:customer?.phone||"",
        city:customer?.city||"",
        state:customer?.state||""
      },
      trackingCode
    };
  }

  /* ==== Helpers ==== */
  function mapIds(ids){const o={};ids.forEach(id=>o[id]=document.getElementById(id));return o;}
  function toggle(el,h){if(el) el.classList.toggle("hidden",h);}
  function getOrderStatusInfo(status){const key=(status||"pending").toString().toLowerCase();return ORDER_STATUS[key]||ORDER_STATUS.pending;}
  function loadCart(){try{return JSON.parse(localStorage.getItem("cart")||"[]");}catch{return []}}
  function saveCart(v){localStorage.setItem("cart",JSON.stringify(v));}
  function formatBRL(n){return n?.toLocaleString?.("pt-BR",{style:"currency",currency:"BRL"})??"R$ 0,00";}
  function sanitizeImg(src){return src||"https://picsum.photos/seed/duoparfum/600/400";}
  function isValidEmail(email=""){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
  function sanitizeTrackingCode(code=""){return code.toString().toUpperCase().replace(/[^A-Z0-9]/g,"");}
  function escapeHtml(s=""){return s.replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
});
