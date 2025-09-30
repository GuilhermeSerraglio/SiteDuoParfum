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
  delivered: { key: "delivered", label: "Entregue", className: "is-delivered", description: "Pedido entregue ao destinatário" },
  canceled: { key: "canceled", label: "Cancelado", className: "is-canceled", description: "Pagamento cancelado ou não aprovado" }
};

const SHIPPING_STATUS_INFO = {
  awaiting_label: { key: "awaiting_label", label: "Aguardando etiqueta", description: "Etiqueta será gerada após aprovação do pagamento." },
  label_generated: { key: "label_generated", label: "Etiqueta gerada", description: "Etiqueta emitida — aguardando postagem." },
  in_transit: { key: "in_transit", label: "Em trânsito", description: "Objeto postado e em deslocamento pelos Correios." },
  out_for_delivery: { key: "out_for_delivery", label: "Saiu para entrega", description: "Objeto saiu para entrega ao destinatário." },
  delivered: { key: "delivered", label: "Entregue", description: "Objeto entregue ao destinatário." },
  awaiting_pickup: { key: "awaiting_pickup", label: "Aguardando retirada", description: "Objeto disponível para retirada na agência dos Correios." },
  pickup: { key: "pickup", label: "Retirada no estúdio", description: "Retire seu pedido conosco conforme combinado." }
};

const SHIPPING_ORIGIN = {
  city: "Sorriso",
  state: "MT",
  cep: "78890000",
};
const SHIPPING_ORIGIN_LABEL = `${SHIPPING_ORIGIN.city} - ${SHIPPING_ORIGIN.state}`;
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
    "checkoutModal","closeCheckout","ckName","ckEmail","ckCep","ckAddress","ckPayment","ckCalcShipping","ckShippingCorreiosArea","ckShippingSummary","ckTotals","ckConfirm","paymentArea","year"
  ]);

  if (els.year) els.year.textContent = new Date().getFullYear();

  initHeroSlider();

  let shippingOptionEls = [];
  let shippingRadioEls = [];

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

  function createDefaultCheckoutShipping(){
    return {
      method: "correios",
      service: "Correios",
      serviceCode: "",
      selectedServiceCode: "",
      preferredServiceCode: "",
      services: [],
      errors: [],
      cost: 0,
      calculated: false,
      deliveryEstimate: "",
      currency: "BRL",
      summary: "",
      lastCep: "",
      cartSignature: "",
      needsRecalculation: false,
      calculatedAt: null,
      deliveryDays: null,
      origin: { ...SHIPPING_ORIGIN },
      originLabel: SHIPPING_ORIGIN_LABEL,
      package: null,
      itemCount: 0,
      trackingStatus: "awaiting_label"
    };
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
    checkoutOrderId: "",
    checkoutShipping: createDefaultCheckoutShipping()
  };

  shippingOptionEls = Array.from(document.querySelectorAll("[data-shipping-option]"));
  shippingRadioEls = shippingOptionEls
    .map(option => option.querySelector("input[type=\"radio\"]"))
    .filter(Boolean);

  shippingRadioEls.forEach(input => {
    input.addEventListener("change", () => setCheckoutShippingMethod(input.value));
  });

  if (els.ckCalcShipping) {
    els.ckCalcShipping.addEventListener("click", handleCalculateShipping);
  }

  state.checkoutShipping.cartSignature = computeCartSignature();
  const initialShipping = shippingRadioEls.find(r => r.checked)?.value || state.checkoutShipping.method || "correios";
  setCheckoutShippingMethod(initialShipping, { updateRadio: true, forceReset: true });

  let orderUnsubscribes = [];
  let orderDocSources = new Map();
  let orderDocs = new Map();
  let orderPendingKeys = new Set();
  let checkoutOrderUnsubscribe = null;
  await loadProducts();
  renderProducts();
  updateCartUI();
  renderOrders();

  /* ==== Funções (produtos/UI) ==== */
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
      slides.forEach((slide, idx) => slide.classList.toggle("is-active", idx === nextIndex));
      dots.forEach((dot, idx) => {
        const isCurrent = idx === nextIndex;
        dot.classList.toggle("is-active", isCurrent);
        dot.setAttribute("aria-pressed", isCurrent ? "true" : "false");
      });
    };

    const stop = () => { if (timerId) { clearInterval(timerId); timerId = null; } };
    const start = () => {
      stop();
      timerId = setInterval(() => setActive(activeIndex + 1), INTERVAL);
    };

    dots.forEach((dot, idx) => dot.addEventListener("click", () => { setActive(idx); start(); }));
    ["mouseenter","focusin"].forEach(ev => root.addEventListener(ev, stop));
    ["mouseleave","focusout"].forEach(ev => root.addEventListener(ev, start));

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
    syncCheckoutShippingAfterCartChange();
  }
  async function confirmCheckout(){
    if(state.processingCheckout) return;

    // exige login para fechar pedido
    if (!auth.currentUser) {
      alert("Você precisa estar logado para finalizar a compra.");
      return;
    }

    const name=(els.ckName?.value||"").trim();
    const email=(els.ckEmail?.value||"").trim().toLowerCase();
    const cepInput=(els.ckCep?.value||"").trim();
    const sanitizedCep=sanitizeCep(cepInput);
    const address=(els.ckAddress?.value||"").trim();
    const payment=els.ckPayment?.value;
    const shippingMethod=sanitizeShippingMethod(state.checkoutShipping?.method);
    const requiresAddress=shippingMethod==="correios";

    if(!name||!email){ alert("Preencha nome e e-mail para continuar."); return; }
    if(!isValidEmail(email)){ alert("Informe um e-mail válido."); return; }
    if(requiresAddress){
      if(!sanitizedCep||sanitizedCep.length!==8){ alert("Informe um CEP válido para entrega pelos Correios."); return; }
      if(!address){ alert("Informe o endereço completo para entrega."); return; }
    }
    if(!state.cart.length){ alert("Carrinho vazio."); return; }

    if(shippingMethod==="correios"){
      const shippingState=state.checkoutShipping||{};
      if(!shippingState.calculated){ alert("Calcule o frete dos Correios antes de finalizar o pedido."); return; }
      if(sanitizedCep&&shippingState.lastCep&&shippingState.lastCep!==sanitizedCep){
        alert("Recalcule o frete para o CEP informado antes de continuar.");
        return;
      }
      if(!shippingState.lastCep||shippingState.lastCep.length!==8){
        alert("Calcule o frete dos Correios para o CEP informado antes de continuar.");
        return;
      }
      if(!shippingState.selectedServiceCode){
        alert("Selecione uma opção de entrega dos Correios antes de finalizar o pedido.");
        return;
      }
    }

    setCheckoutProcessing(true);
    if (els.paymentArea) els.paymentArea.innerHTML="<p class=\"muted\">Gerando pagamento...</p>";

    const subtotal=getCheckoutSubtotal();
    const shippingState=state.checkoutShipping||{};
    const correiosServices=Array.isArray(shippingState.services)?shippingState.services:[];
    const selectedService=shippingMethod==="correios"
      ? correiosServices.find(service=>service.serviceCode===shippingState.selectedServiceCode)
      : null;
    const shippingCost=shippingMethod==="correios"&&shippingState.calculated
      ? Math.max(0,Number((selectedService&&selectedService.cost!=null?selectedService.cost:shippingState.cost))||0)
      :0;
    const total=subtotal+shippingCost;
    const originLabel=shippingMethod==="pickup"?"":(shippingState.originLabel||SHIPPING_ORIGIN_LABEL);

    const shippingDetails={
      method:shippingMethod,
      methodLabel:shippingMethod==="pickup"?"Retirada no local":"Entrega pelos Correios",
      service:shippingMethod==="pickup"?"Retirada":(selectedService?.name||shippingState.service||"Correios"),
      cost:shippingCost,
      currency:shippingState.currency||"BRL",
      deliveryEstimate:shippingMethod==="pickup"
        ?"Disponível para retirada após confirmação do pagamento"
        :((selectedService?.deliveryEstimate)||shippingState.deliveryEstimate||""),
      deliveryDays:shippingMethod==="pickup"?null:(selectedService?.deliveryDays||shippingState.deliveryDays||null),
      calculatedAt:shippingMethod==="pickup"
        ?new Date()
        :(shippingState.calculatedAt instanceof Date?shippingState.calculatedAt:new Date()),
      cep:shippingMethod==="pickup"?"":(shippingState.lastCep||sanitizedCep),
      origin:shippingMethod==="pickup"?null:(shippingState.origin||{...SHIPPING_ORIGIN}),
      originLabel:originLabel,
      instructions:shippingMethod==="pickup"
        ?"Retire no estúdio Duo Parfum mediante agendamento após confirmação."
        :""
    };

    if(shippingMethod==="correios"){
      const servicesSnapshot=correiosServices.map(service=>({
        method:service?.method||"correios",
        name:service?.name||service?.service||"Correios",
        serviceCode:String(service?.serviceCode||service?.code||"").trim(),
        cost:Number.isFinite(Number(service?.cost))?Number(service.cost):null,
        currency:service?.currency||"BRL",
        deliveryEstimate:service?.deliveryEstimate||"",
        deliveryDays:service?.deliveryDays||null,
        calculatedAt:service?.calculatedAt||(
          shippingDetails.calculatedAt instanceof Date
            ? shippingDetails.calculatedAt.toISOString()
            : new Date().toISOString()
        ),
        error:service?.error||null
      }));
      const errorsSnapshot=Array.isArray(shippingState.errors)
        ? shippingState.errors.map(err=>({
            service:err?.service||"",
            serviceCode:err?.serviceCode||"",
            message:err?.message||"",
            code:err?.code||null
          }))
        : [];
      const pkg=shippingState.package||null;
      shippingDetails.serviceCode=shippingState.serviceCode||selectedService?.serviceCode||"";
      shippingDetails.selectedServiceCode=shippingState.selectedServiceCode||selectedService?.serviceCode||"";
      shippingDetails.preferredServiceCode=shippingState.preferredServiceCode||"";
      shippingDetails.services=servicesSnapshot;
      shippingDetails.errors=errorsSnapshot;
      shippingDetails.package=pkg
        ? {
            weightKg:Number(pkg.weightKg)||0,
            billedWeightKg:Number(pkg.billedWeightKg)||0,
            declaredValue:Number(pkg.declaredValue)||0,
            dimensions:{
              formato:pkg.dimensions?.formato||"1",
              comprimento:Number(pkg.dimensions?.comprimento)||16,
              altura:Number(pkg.dimensions?.altura)||2,
              largura:Number(pkg.dimensions?.largura)||11,
              diametro:Number(pkg.dimensions?.diametro)||0
            }
          }
        : null;
      shippingDetails.itemCount=Number(shippingState.itemCount)||0;
      shippingDetails.trackingStatus=shippingState.trackingStatus||"awaiting_label";
      shippingDetails.quote={
        calculatedAt:shippingDetails.calculatedAt instanceof Date
          ? shippingDetails.calculatedAt.toISOString()
          : shippingDetails.calculatedAt,
        destinationCep:shippingDetails.cep,
        originCep:shippingDetails.origin?.cep||SHIPPING_ORIGIN.cep,
        services:servicesSnapshot,
        errors:errorsSnapshot
      };
    }else{
      shippingDetails.serviceCode="";
      shippingDetails.selectedServiceCode="";
      shippingDetails.preferredServiceCode="";
      shippingDetails.services=[];
      shippingDetails.errors=[];
      shippingDetails.package=null;
      shippingDetails.itemCount=Number(shippingState.itemCount)||0;
      shippingDetails.trackingStatus="pickup";
      shippingDetails.quote={
        calculatedAt:shippingDetails.calculatedAt instanceof Date
          ? shippingDetails.calculatedAt.toISOString()
          : shippingDetails.calculatedAt,
        destinationCep:"",
        originCep:SHIPPING_ORIGIN.cep,
        services:[],
        errors:[]
      };
    }
    shippingDetails.status=shippingDetails.trackingStatus;

    const order={
      userId: auth.currentUser?.uid || null,
      items: state.cart.map(i=>({id:i.id,name:i.name,ml:i.ml||"",price:i.price,qty:i.qty})),
      subtotal,
      shipping: shippingDetails,
      total,
      createdAt:new Date(),
      status:"pending",
      customer:{
        name,
        email,
        cep:sanitizedCep,
        address,
        payment,
        shippingMethod,
        deliveryMethod:shippingDetails.methodLabel
      }
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
      // sua API de pagamento decide PIX/Cartão e devolve link/qr/code
      const resp=await fetch("/api/payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId,order})});
      if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data=await resp.json();
      if(data.error) throw new Error(data.error);

      if(payment==="pix"){
        if(els.paymentArea){
          const pixParts=["<p>Escaneie o QRCode para pagar:</p>"];
          if(data.qr){ pixParts.push(`<img src="data:image/png;base64,${data.qr}" style="max-width:200px">`); }
          else { pixParts.push("<p class=\"muted\">QRCode indisponível. Utilize o código abaixo para concluir o pagamento.</p>"); }
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

      if (els.paymentArea){
        els.paymentArea.insertAdjacentHTML("beforeend","<p class=\"muted\" style=\"margin-top:12px\">Pedido registrado com sucesso. Utilize o pagamento acima para concluir sua compra.</p>");
        const shippingInfoParts=[];
        if(shippingMethod==="pickup"){
          shippingInfoParts.push("Entrega: retirada no estúdio Duo Parfum após confirmação.");
        }else{
          shippingInfoParts.push(`Frete ${escapeHtml(shippingDetails.service||"Correios")}: ${formatBRL(shippingCost)}`);
          if(shippingDetails.deliveryEstimate){ shippingInfoParts.push(escapeHtml(shippingDetails.deliveryEstimate)); }
          if(shippingDetails.originLabel){ shippingInfoParts.push(`Postagem: ${escapeHtml(shippingDetails.originLabel)}`); }
          if(shippingDetails.instructions){ shippingInfoParts.push(escapeHtml(shippingDetails.instructions)); }
        }
        if(shippingInfoParts.length){
          els.paymentArea.insertAdjacentHTML("beforeend",`<p class=\"muted\" style=\"margin-top:6px\">${shippingInfoParts.join(" • ")}</p>`);
        }
      }

      // esvazia carrinho
      state.cart=[];
      saveCart(state.cart);
      updateCartUI();
      openDrawer(false);
      markCheckoutCompleted();

      // começa a escutar o status do pedido (paid/canceled) em tempo real
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
    if(existing){ existing.outerHTML=html; } else { els.paymentArea.insertAdjacentHTML("afterbegin",html); }
  }

  function renderCheckoutPaymentStatusError(message){
    if(!els.paymentArea) return;
    const html=`<div class="payment-status-banner is-error" data-payment-status>
      <strong>Status do pagamento</strong>
      <span>${escapeHtml(message||"Não foi possível confirmar o status do pagamento automaticamente.")}</span>
    </div>`;
    const existing=els.paymentArea.querySelector("[data-payment-status]");
    if(existing){ existing.outerHTML=html; } else { els.paymentArea.insertAdjacentHTML("afterbegin",html); }
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
    if(els.ckCalcShipping){
      els.ckCalcShipping.disabled=false;
      els.ckCalcShipping.textContent="Calcular frete";
    }
    if(els.ckShippingSummary){
      els.ckShippingSummary.textContent="";
      els.ckShippingSummary.classList.remove("error-text");
    }
    const resetShipping=createDefaultCheckoutShipping();
    resetShipping.cartSignature=computeCartSignature();
    state.checkoutShipping=resetShipping;
    setCheckoutShippingMethod("correios",{updateRadio:true,forceReset:true});
  }

  function setCheckoutShippingMethod(method,options={}){
    const {updateRadio=false,forceReset=false}=options;
    const normalized=sanitizeShippingMethod(method);
    const prev=state.checkoutShipping||createDefaultCheckoutShipping();
    const next={
      ...prev,
      method:normalized,
      cartSignature:computeCartSignature()
    };

    if(normalized==="pickup"){
      Object.assign(next,{
        service:"Retirada",
        serviceCode:"",
        selectedServiceCode:"",
        preferredServiceCode:"",
        services:[],
        errors:[],
        currency:"BRL",
        cost:0,
        calculated:true,
        needsRecalculation:false,
        deliveryEstimate:"Disponível para retirada após confirmação do pagamento",
        deliveryDays:null,
        lastCep:"",
        calculatedAt:new Date(),
        origin:null,
        originLabel:"",
        package:null,
        itemCount:0,
        trackingStatus:"awaiting_label"
      });
    }else{
      Object.assign(next,{
        service:prev.service||"Correios",
        serviceCode:prev.serviceCode||prev.selectedServiceCode||prev.preferredServiceCode||"",
        currency:prev.currency||"BRL",
        origin:prev.origin||{...SHIPPING_ORIGIN},
        originLabel:prev.originLabel||SHIPPING_ORIGIN_LABEL,
        trackingStatus:prev.trackingStatus||"awaiting_label"
      });

      if(forceReset||prev.method!==normalized){
        Object.assign(next,{
          service:"Correios",
          serviceCode:"",
          selectedServiceCode:"",
          preferredServiceCode:"",
          services:[],
          errors:[],
          cost:0,
          calculated:false,
          needsRecalculation:false,
          deliveryEstimate:"",
          deliveryDays:null,
          lastCep:"",
          calculatedAt:null,
          origin:{...SHIPPING_ORIGIN},
          originLabel:SHIPPING_ORIGIN_LABEL,
          package:null,
          itemCount:0
        });
      }
    }

    state.checkoutShipping=next;

    if(shippingOptionEls.length){
      shippingOptionEls.forEach(option=>{
        const input=option.querySelector("input[type=\"radio\"]");
        const isCurrent=input?.value===normalized;
        if(updateRadio&&input){ input.checked=isCurrent; }
        option.classList.toggle("is-active",!!isCurrent);
      });
    }

    updateCheckoutShippingUI();
    renderCheckoutTotals();
  }

  async function handleCalculateShipping(){
    if(!state.cart.length){ alert("Carrinho vazio."); return; }
    const cepInput=(els.ckCep?.value||"").trim();
    const cep=sanitizeCep(cepInput);
    if(cep.length!==8){ alert("Informe um CEP válido para calcular o frete."); return; }

    if(els.ckCalcShipping){
      els.ckCalcShipping.disabled=true;
      els.ckCalcShipping.textContent="Calculando...";
    }
    if(els.ckShippingSummary){
      els.ckShippingSummary.classList.remove("error-text");
      els.ckShippingSummary.textContent="Calculando frete...";
    }

    try{
      const subtotal=getCheckoutSubtotal();
      const payload={
        cep,
        subtotal,
        items:state.cart.map(item=>({
          id:item.id,
          qty:item.qty,
          price:item.price,
          ml:item.ml
        }))
      };
      const resp=await fetch("/api/shipping",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const text=await resp.text();
      let data={};
      if(text){ try{ data=JSON.parse(text); }catch{ data={}; } }
      if(!resp.ok){
        const message=data?.error||`HTTP ${resp.status}`;
        throw new Error(message);
      }

      const rawServices=Array.isArray(data?.services)?data.services:[];
      const services=rawServices.map(service=>({
        method:service?.method||"correios",
        name:service?.name||service?.service||"Correios",
        serviceCode:String(service?.serviceCode||service?.code||"").trim(),
        cost:Number(service?.cost),
        currency:service?.currency||"BRL",
        deliveryEstimate:service?.deliveryEstimate||"",
        deliveryDays:service?.deliveryDays||null,
        calculatedAt:service?.calculatedAt||data?.calculatedAt||new Date().toISOString(),
        error:service?.error||null
      }));
      const validServices=services.filter(item=>Number.isFinite(item.cost)&&item.cost>=0&&!item.error);
      if(!validServices.length){
        const firstError=data?.errors?.[0]?.message||data?.error||services.find(item=>item.error)?.error;
        throw new Error(firstError||"Frete indisponível no momento.");
      }

      const preferredCode=String(data?.preferredServiceCode||"").trim();
      const previousSelected=String(state.checkoutShipping?.selectedServiceCode||"").trim();
      const selectedService=validServices.find(item=>item.serviceCode===previousSelected)
        || validServices.find(item=>item.serviceCode===preferredCode)
        || validServices[0];

      const nextShipping={
        ...state.checkoutShipping,
        method:"correios",
        service:selectedService?.name||"Correios",
        serviceCode:selectedService?.serviceCode||"",
        selectedServiceCode:selectedService?.serviceCode||"",
        preferredServiceCode:preferredCode||selectedService?.serviceCode||"",
        services,
        errors:Array.isArray(data?.errors)?data.errors:[],
        cost:Number(selectedService?.cost)||0,
        currency:selectedService?.currency||"BRL",
        calculated:true,
        deliveryEstimate:selectedService?.deliveryEstimate||"",
        deliveryDays:selectedService?.deliveryDays||null,
        calculatedAt:data?.calculatedAt?new Date(data.calculatedAt):new Date(),
        lastCep:cep,
        needsRecalculation:false,
        cartSignature:computeCartSignature(),
        origin:data?.origin?{...data.origin}:{...SHIPPING_ORIGIN},
        originLabel:data?.originLabel||SHIPPING_ORIGIN_LABEL,
        package:data?.package||state.checkoutShipping?.package||null,
        itemCount:Number(data?.itemCount)||state.checkoutShipping?.itemCount||0
      };

      state.checkoutShipping=nextShipping;

      updateCheckoutShippingUI();
    }catch(err){
      console.error("Erro ao calcular frete:", err);
      const message=err?.message||"Não foi possível calcular o frete.";
      if(els.ckShippingSummary){
        els.ckShippingSummary.textContent=message;
        els.ckShippingSummary.classList.add("error-text");
      }
      state.checkoutShipping={
        ...state.checkoutShipping,
        calculated:false,
        needsRecalculation:true,
        cost:0,
        deliveryEstimate:"",
        deliveryDays:null,
        services:[],
        errors:[],
        selectedServiceCode:"",
        serviceCode:"",
        package:null,
        itemCount:0,
        origin:{...SHIPPING_ORIGIN},
        originLabel:SHIPPING_ORIGIN_LABEL
      };
    }finally{
      if(els.ckCalcShipping){
        els.ckCalcShipping.disabled=false;
        els.ckCalcShipping.textContent="Calcular frete";
      }
      renderCheckoutTotals();
    }
  }

  function updateCheckoutShippingUI(){
    const shippingState=state.checkoutShipping||{};
    const method=sanitizeShippingMethod(shippingState.method);
    if(shippingOptionEls.length){
      shippingOptionEls.forEach(option=>{
        const input=option.querySelector("input[type=\"radio\"]");
        const isCurrent=input?.value===method;
        if(input){ input.checked=isCurrent; }
        option.classList.toggle("is-active",!!isCurrent);
      });
    }
    if(els.ckShippingCorreiosArea) toggle(els.ckShippingCorreiosArea, method!=="correios");
    if(!els.ckShippingSummary) return;
    if(method!=="correios"){
      els.ckShippingSummary.innerHTML="";
      els.ckShippingSummary.classList.remove("error-text");
      return;
    }
    renderShippingServiceOptions();
  }

  function renderShippingServiceOptions(){
    if(!els.ckShippingSummary) return;
    let shippingState=state.checkoutShipping||{};
    const summaryEl=els.ckShippingSummary;
    summaryEl.classList.remove("error-text");

    const method=sanitizeShippingMethod(shippingState.method);
    if(method!=="correios"){
      summaryEl.innerHTML="";
      return;
    }

    if(!shippingState.calculated){
      if(shippingState.needsRecalculation){
        summaryEl.textContent="Carrinho atualizado — calcule novamente o frete para ver o valor final.";
      }else{
        summaryEl.textContent="Informe o CEP e clique em \"Calcular frete\".";
      }
      return;
    }

    const services=Array.isArray(shippingState.services)?shippingState.services:[];
    if(!services.length){
      summaryEl.textContent="Nenhuma opção de frete disponível no momento.";
      summaryEl.classList.add("error-text");
      return;
    }

    const validServices=services.filter(service=>Number.isFinite(service.cost)&&service.cost>=0&&!service.error);
    let selectedCode=String(shippingState.selectedServiceCode||"").trim();
    if(validServices.length){
      const hasSelected=validServices.some(service=>service.serviceCode===selectedCode);
      if(!hasSelected){
        const fallback=validServices[0];
        selectedCode=fallback.serviceCode||"";
        state.checkoutShipping={
          ...state.checkoutShipping,
          service:fallback.name||"Correios",
          serviceCode:fallback.serviceCode||"",
          selectedServiceCode:fallback.serviceCode||"",
          cost:Number(fallback.cost)||0,
          currency:fallback.currency||"BRL",
          deliveryEstimate:fallback.deliveryEstimate||"",
          deliveryDays:fallback.deliveryDays||null
        };
        shippingState=state.checkoutShipping;
      }
    }

    const optionsHtml=services.map(service=>{
      const code=String(service.serviceCode||"").trim();
      const isError=!!service.error||!Number.isFinite(service.cost)||service.cost<0;
      const isSelected=!isError&&code===String(shippingState.selectedServiceCode||"").trim();
      const priceLabel=Number.isFinite(service.cost)&&service.cost>=0?formatBRL(Math.max(0,service.cost)):"Indisponível";
      const optionClasses=["shipping-service-option"];
      if(isSelected) optionClasses.push("is-selected");
      if(isError) optionClasses.push("is-disabled");
      const detailsParts=[];
      if(service.deliveryEstimate) detailsParts.push(escapeHtml(service.deliveryEstimate));
      if(service.error) detailsParts.push(`<span class="shipping-service-option__error">${escapeHtml(service.error)}</span>`);
      const detailsHtml=detailsParts.length?`<span class="shipping-service-option__details">${detailsParts.join(" • ")}</span>`:"";
      const checkedAttr=isSelected?" checked":"";
      const disabledAttr=isError?" disabled":"";
      return `<label class="${optionClasses.join(" ")}"><input type="radio" name="ckCorreiosService" value="${escapeHtml(code)}" data-service-radio${checkedAttr}${disabledAttr}><div class="shipping-service-option__info"><span class="shipping-service-option__title">${escapeHtml(service.name||"Correios")}</span><span class="shipping-service-option__price">${escapeHtml(priceLabel)}</span>${detailsHtml}</div></label>`;
    }).join("");

    const originLine=shippingState.originLabel?`<p class="shipping-service-origin muted">Postagem: ${escapeHtml(shippingState.originLabel)}</p>`:"";
    const warning=!validServices.length?`<p class="shipping-service-warning error-text">Nenhuma opção de frete disponível no momento.</p>`:"";

    summaryEl.innerHTML=`<div class="shipping-service-list" data-shipping-service-list>${optionsHtml}</div>${originLine}${warning}`;

    const radios=Array.from(summaryEl.querySelectorAll("[data-service-radio]"));
    radios.forEach(input=>{
      input.addEventListener("change",ev=>{
        selectCheckoutCorreiosService(ev.target.value);
      });
    });

    if(!validServices.length){
      summaryEl.classList.add("error-text");
    }

    renderCheckoutTotals();
  }

  function selectCheckoutCorreiosService(serviceCode){
    const shippingState=state.checkoutShipping||{};
    const services=Array.isArray(shippingState.services)?shippingState.services:[];
    const code=String(serviceCode||"").trim();
    const service=services.find(item=>item.serviceCode===code&&!item.error&&Number.isFinite(item.cost));
    if(!service) return;

    state.checkoutShipping={
      ...shippingState,
      service:service.name||"Correios",
      serviceCode:service.serviceCode||"",
      selectedServiceCode:service.serviceCode||"",
      cost:Number(service.cost)||0,
      currency:service.currency||"BRL",
      deliveryEstimate:service.deliveryEstimate||"",
      deliveryDays:service.deliveryDays||null
    };

    renderShippingServiceOptions();
    renderCheckoutTotals();
  }

  function renderCheckoutTotals(){
    if(!els.ckTotals) return;
    const subtotal=getCheckoutSubtotal();
    const shippingState=state.checkoutShipping||{};
    const method=sanitizeShippingMethod(shippingState.method);
    const shippingCalculated=method==="correios"&&shippingState.calculated;
    const shippingCost=shippingCalculated?Math.max(0,Number(shippingState.cost)||0):0;
    const total=subtotal+shippingCost;
    const serviceLabel=method==="pickup"?"Retirada no local":`Frete (${shippingState.service||"Correios"})`;
    let shippingValue;
    if(method==="pickup"){ shippingValue="Sem custo"; }
    else if(shippingCalculated){ shippingValue=formatBRL(shippingCost); }
    else { shippingValue=shippingState.needsRecalculation?"Recalcular":"Calcular"; }

    els.ckTotals.innerHTML=`
      <div class="checkout-totals__row"><span>Subtotal</span><strong>${formatBRL(subtotal)}</strong></div>
      <div class="checkout-totals__row"><span>${escapeHtml(serviceLabel)}</span><strong>${escapeHtml(String(shippingValue))}</strong></div>
      <div class="checkout-totals__divider"></div>
      <div class="checkout-totals__row checkout-totals__total"><span>Total</span><strong>${formatBRL(total)}</strong></div>
    `;
  }

  function syncCheckoutShippingAfterCartChange(){
    if(!state.checkoutShipping) return;
    const signature=computeCartSignature();
    const previous=state.checkoutShipping.cartSignature||"";
    if(signature!==previous){
      const wasCalculated=state.checkoutShipping.calculated;
      state.checkoutShipping.cartSignature=signature;
      if(state.checkoutShipping.method==="correios"){
        state.checkoutShipping.calculated=false;
        state.checkoutShipping.cost=0;
        state.checkoutShipping.deliveryEstimate="";
        state.checkoutShipping.deliveryDays=null;
        state.checkoutShipping.calculatedAt=null;
        state.checkoutShipping.needsRecalculation=wasCalculated;
        state.checkoutShipping.lastCep=wasCalculated?state.checkoutShipping.lastCep||"":"";
        state.checkoutShipping.services=[];
        state.checkoutShipping.errors=[];
        state.checkoutShipping.selectedServiceCode="";
        state.checkoutShipping.serviceCode="";
        state.checkoutShipping.package=null;
        state.checkoutShipping.itemCount=0;
      }
      updateCheckoutShippingUI();
    }
    renderCheckoutTotals();
  }

  function getCheckoutSubtotal(){
    return state.cart.reduce((sum,item)=>{
      const price=Number(item?.price)||0;
      const qty=Math.max(0, Number(item?.qty)||0);
      return sum+(price*qty);
    },0);
  }

  function computeCartSignature(cart=state.cart){
    if(!Array.isArray(cart)||!cart.length) return "";
    return cart
      .map(item=>`${item?.id||""}:${Math.max(0, Number(item?.qty)||0)}`)
      .sort()
      .join("|");
  }
  /* ==== Pedidos (do usuário) ==== */
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
    orderDocs.forEach(doc=>{ orders.push(mapOrderDocument(doc)); });
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
    const shipping=order.shipping||{};
    const shippingMethod=sanitizeShippingMethod(shipping.method);
    const shippingStatusInfo=getShippingStatusInfo(shipping.trackingStatus||shipping.status);
    const destination=shippingMethod==="pickup"
      ?"Retirada no local"
      :[customer.address,formatCep(shipping.cep||customer.cep)].filter(Boolean).join(" · ");

    const shippingCostValue=shippingMethod==="correios"?Math.max(0,Number(shipping.cost)||0):0;
    const shippingService=(shipping.service||"").trim()||"Correios";
    const shippingLabelParts=[];
    if(shippingMethod==="pickup"){
      shippingLabelParts.push("Retirada no local");
      if(shipping.instructions){ shippingLabelParts.push(escapeHtml(shipping.instructions)); }
    }else{
      const serviceLabel=shippingService.toLowerCase()!=="correios"
        ? `Correios — ${escapeHtml(shippingService)}`
        : "Correios";
      shippingLabelParts.push(serviceLabel);
      if(shippingCostValue>0){ shippingLabelParts.push(formatBRL(shippingCostValue)); }
      if(shipping.deliveryEstimate){ shippingLabelParts.push(escapeHtml(shipping.deliveryEstimate)); }
      if(shipping.originLabel){ shippingLabelParts.push(`Postagem: ${escapeHtml(shipping.originLabel)}`); }
    }
    if(shippingStatusInfo){ shippingLabelParts.push(escapeHtml(shippingStatusInfo.label)); }
    const shippingDisplay=shippingLabelParts.join(" • ");

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

    const trackingActions=[];
    if(order.trackingCode){
      trackingActions.push(`<button class="btn small ghost" data-refresh-tracking="${order.id}">Atualizar rastreio</button>`);
      trackingActions.push(`<a class="btn small ghost" href="https://rastreamento.correios.com.br/app/index.php?codigo=${encodeURIComponent(order.trackingCode)}" target="_blank" rel="noreferrer">Ver no site dos Correios</a>`);
    }
    if(shippingMethod==="correios"&&shipping.labelUrl){
      trackingActions.push(`<a class="btn small ghost" href="${escapeHtml(shipping.labelUrl)}" target="_blank" rel="noreferrer">Baixar etiqueta</a>`);
    }
    const actionsHtml=trackingActions.length?`<div class="order-card__tracking-actions">${trackingActions.join("")}</div>`:"";
    const statusInfoHtml=shippingStatusInfo
      ? `<div class="order-tracking__status-info"><strong>${escapeHtml(shippingStatusInfo.label)}</strong><span class="muted">${escapeHtml(shippingStatusInfo.description)}</span></div>`
      : "";

    let trackingSection;
    if(order.trackingCode){
      trackingSection=`<div class="order-tracking" data-order-id="${order.id}">
          <div class="order-tracking__code">Código: <strong>${escapeHtml(order.trackingCode)}</strong></div>
          ${statusInfoHtml}
          <div class="order-tracking__status" data-tracking-status="${order.id}">
            <span class="muted">Consultando status nos Correios...</span>
          </div>
          ${actionsHtml}
        </div>`;
    }else if(shippingMethod==="pickup"){
      const fallbackInfo=statusInfoHtml||`<p class="muted">Este pedido ficará disponível para retirada no estúdio Duo Parfum após a confirmação do pagamento.</p>`;
      trackingSection=`<div class="order-tracking" data-order-id="${order.id}">
          ${fallbackInfo}
          ${actionsHtml}
        </div>`;
    }else{
      const defaultMessage=statusInfoHtml||`<p class="muted">O código de rastreio será informado assim que o pedido for postado nos Correios de ${escapeHtml(shipping.originLabel||SHIPPING_ORIGIN_LABEL)}.</p>`;
      trackingSection=`<div class="order-tracking" data-order-id="${order.id}">
          ${defaultMessage}
          ${actionsHtml}
        </div>`;
    }

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
            <span class="order-card__label">Entrega</span>
            <span class="order-card__value">${escapeHtml(shippingDisplay||"Em confirmação")}</span>
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

  /* ==== Rastreio Correios (cliente) ==== */
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
    fetchTracking(code,id)
      .then(data=>{
        state.orderTracking[id]={code,status:"loaded",data,fetchedAt:new Date()};
        updateTrackingUI(id);
      })
      .catch(err=>{
        state.orderTracking[id]={code,status:"error",message:err?.message||"Falha ao consultar rastreio"};
        updateTrackingUI(id);
      });
  }

  async function fetchTracking(code,orderId){
    const params=new URLSearchParams({code});
    if(orderId) params.append("orderId",orderId);
    const resp=await fetch(`/api/tracking?${params.toString()}`);
    const text=await resp.text();
    let payload={};
    if(text){ try{ payload=JSON.parse(text); }catch{ payload={}; } }
    if(!resp.ok){
      const message=payload?.error||`HTTP ${resp.status}`;
      throw new Error(message);
    }
    if(payload?.error){ throw new Error(payload.error); }
    return payload;
  }

  function updateTrackingUI(orderId){
    if(!orderId||!els.ordersList) return;
    const container=els.ordersList.querySelector(`[data-tracking-status="${orderId}"]`);
    if(!container) return;
    const tracking=state.orderTracking[orderId];
    const order=state.orders.find(o=>o.id===orderId);
    const shippingMethod=sanitizeShippingMethod(order?.shipping?.method);
    const originLabel=order?.shipping?.originLabel||SHIPPING_ORIGIN_LABEL;
    const shippingStatusInfo=getShippingStatusInfo(order?.shipping?.trackingStatus||order?.shipping?.status);

    if(!tracking||!tracking.code){
      if(shippingMethod==="pickup"){
        const message=shippingStatusInfo?.description||"Retirada no estúdio Duo Parfum — agende a melhor data com nossa equipe.";
        container.innerHTML=`<span class="muted">${escapeHtml(message)}</span>`;
      }else{
        const message=shippingStatusInfo?.description||`Aguardando código de rastreio. Postagem será realizada nos Correios de ${originLabel}.`;
        container.innerHTML=`<span class="muted">${escapeHtml(message)}</span>`;
      }
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
    const infoParts=[]; if(momentHtml) infoParts.push(momentHtml); if(locationHtml) infoParts.push(locationHtml);
    const infoLine=infoParts.length?`<span>${infoParts.join(" · ")}</span>`:"";
    const detailsText=last.details&&last.details!==last.description?last.details:last.description;
    const detailsHtml=detailsText?`<p>${escapeHtml(detailsText)}</p>`:"";
    const fetchedHtml=tracking.fetchedAt?`<span class="muted">Atualizado em ${escapeHtml(formatOrderDate(tracking.fetchedAt))}</span>`:"";

    const historyItems=events.map(ev=>{
      const eventTitle=escapeHtml(ev.status||ev.description||"Atualização");
      const eventMoment=formatTrackingMoment(ev);
      const eventMomentHtml=eventMoment?escapeHtml(eventMoment):"";
      const eventLocation=ev.location?escapeHtml(ev.location):"";
      const info=[]; if(eventMomentHtml) info.push(eventMomentHtml); if(eventLocation) info.push(eventLocation);
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
    if(!(date instanceof Date)){ date=new Date(date); }
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
    })): [];
    const customer=data?.customer||{};
    const shippingRaw=typeof data?.shipping==="object"&&data.shipping?data.shipping:{};
    const shippingMethod=sanitizeShippingMethod(shippingRaw.method||customer?.shippingMethod||"");
    const trackingCode=sanitizeTrackingCode(data?.trackingCode||shippingRaw?.trackingCode||"");
    const calculatedAt=typeof shippingRaw?.calculatedAt?.toDate==="function"
      ? shippingRaw.calculatedAt.toDate()
      : shippingRaw?.calculatedAt instanceof Date?shippingRaw.calculatedAt:null;
    const trackingGeneratedAt=typeof shippingRaw?.trackingGeneratedAt?.toDate==="function"
      ? shippingRaw.trackingGeneratedAt.toDate()
      : shippingRaw?.trackingGeneratedAt instanceof Date?shippingRaw.trackingGeneratedAt:null;
    const subtotalValue=Number(data?.subtotal);
    const subtotal=Number.isFinite(subtotalValue)?subtotalValue:items.reduce((sum,item)=>sum+(Number(item.price)||0)*(Number(item.qty)||0),0);
    const quoteRaw=shippingRaw?.quote;
    const quote=quoteRaw&&typeof quoteRaw==="object"
      ? {
          calculatedAt:typeof quoteRaw.calculatedAt?.toDate==="function"
            ? quoteRaw.calculatedAt.toDate()
            : quoteRaw.calculatedAt||null,
          destinationCep:quoteRaw.destinationCep||shippingRaw?.cep||customer?.cep||"",
          originCep:quoteRaw.originCep||shippingRaw?.origin?.cep||SHIPPING_ORIGIN.cep,
          services:Array.isArray(quoteRaw.services)?quoteRaw.services:[],
          errors:Array.isArray(quoteRaw.errors)?quoteRaw.errors:[]
        }
      : null;

    return {
      id:doc.id,
      status:data?.status||"pending",
      createdAt,
      items,
      subtotal,
      total:Number(data?.total)||0,
      customer:{
        name:customer?.name||"",
        email:customer?.email||"",
        cep:customer?.cep||"",
        address:customer?.address||"",
        payment:customer?.payment||"",
        phone:customer?.phone||"",
        city:customer?.city||"",
        state:customer?.state||"",
        shippingMethod,
        deliveryMethod:customer?.deliveryMethod||shippingRaw?.methodLabel||""
      },
      shipping:{
        method:shippingMethod,
        methodLabel:shippingRaw?.methodLabel||(shippingMethod==="pickup"?"Retirada no local":"Entrega pelos Correios"),
        service:shippingRaw?.service||(shippingMethod==="pickup"?"Retirada":"Correios"),
        serviceCode:shippingRaw?.serviceCode||shippingRaw?.selectedServiceCode||"",
        selectedServiceCode:shippingRaw?.selectedServiceCode||shippingRaw?.serviceCode||"",
        preferredServiceCode:shippingRaw?.preferredServiceCode||"",
        cost:Number(shippingRaw?.cost)||0,
        currency:shippingRaw?.currency||"BRL",
        deliveryEstimate:shippingRaw?.deliveryEstimate||"",
        deliveryDays:shippingRaw?.deliveryDays||null,
        calculatedAt,
        cep:shippingRaw?.cep||customer?.cep||"",
        origin:shippingMethod==="pickup"?null:(shippingRaw?.origin||{...SHIPPING_ORIGIN}),
        originLabel:shippingMethod==="pickup"?"":(shippingRaw?.originLabel||SHIPPING_ORIGIN_LABEL),
        instructions:shippingRaw?.instructions||"",
        services:Array.isArray(shippingRaw?.services)?shippingRaw.services.map(service=>({
          method:service?.method||"correios",
          name:service?.name||service?.service||"Correios",
          serviceCode:String(service?.serviceCode||service?.code||"").trim(),
          cost:Number.isFinite(Number(service?.cost))?Number(service.cost):null,
          currency:service?.currency||"BRL",
          deliveryEstimate:service?.deliveryEstimate||"",
          deliveryDays:service?.deliveryDays||null,
          calculatedAt:service?.calculatedAt||null,
          error:service?.error||null
        })) : [],
        errors:Array.isArray(shippingRaw?.errors)?shippingRaw.errors.map(err=>({
          service:err?.service||"",
          serviceCode:err?.serviceCode||"",
          message:err?.message||"",
          code:err?.code||null
        })) : [],
        package:shippingRaw?.package
          ? {
              weightKg:Number(shippingRaw.package.weightKg)||0,
              billedWeightKg:Number(shippingRaw.package.billedWeightKg)||0,
              declaredValue:Number(shippingRaw.package.declaredValue)||0,
              dimensions:{
                formato:shippingRaw.package.dimensions?.formato||"1",
                comprimento:Number(shippingRaw.package.dimensions?.comprimento)||16,
                altura:Number(shippingRaw.package.dimensions?.altura)||2,
                largura:Number(shippingRaw.package.dimensions?.largura)||11,
                diametro:Number(shippingRaw.package.dimensions?.diametro)||0
              }
            }
          : null,
        itemCount:Number(shippingRaw?.itemCount)||0,
        labelUrl:shippingRaw?.labelUrl||"",
        labelId:shippingRaw?.labelId||"",
        trackingStatus:shippingRaw?.trackingStatus||shippingRaw?.status||"",
        status:shippingRaw?.status||shippingRaw?.trackingStatus||"",
        trackingHistory:Array.isArray(shippingRaw?.trackingHistory)?shippingRaw.trackingHistory:[],
        lastTrackingEvent:shippingRaw?.lastTrackingEvent||null,
        quote,
        trackingGeneratedAt,
        trackingGeneratedBy:shippingRaw?.trackingGeneratedBy||""
      },
      trackingCode
    };
  }

  /* ==== Helpers ==== */
  function mapIds(ids){const o={};ids.forEach(id=>o[id]=document.getElementById(id));return o;}
  function toggle(el,h){if(el) el.classList.toggle("hidden",h);}
  function getOrderStatusInfo(status){const key=(status||"pending").toString().toLowerCase();return ORDER_STATUS[key]||ORDER_STATUS.pending;}
  function getShippingStatusInfo(status){const key=(status||"").toString().toLowerCase();return SHIPPING_STATUS_INFO[key]||null;}
  function loadCart(){try{return JSON.parse(localStorage.getItem("cart")||"[]");}catch{return []}}
  function saveCart(v){localStorage.setItem("cart",JSON.stringify(v));}
  function formatBRL(n){return n?.toLocaleString?.("pt-BR",{style:"currency",currency:"BRL"})??"R$ 0,00";}
  function sanitizeImg(src){return src||"https://picsum.photos/seed/duoparfum/600/400";}
  function isValidEmail(email=""){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
  function sanitizeTrackingCode(code=""){return code.toString().toUpperCase().replace(/[^A-Z0-9]/g,"");}
  function sanitizeShippingMethod(value=""){const normalized=(value||"").toString().toLowerCase();if(["pickup","retirada","retirar"].includes(normalized)) return "pickup";return "correios";}
  function sanitizeCep(value=""){return value.toString().replace(/\D/g,"").slice(0,8);}
  function formatCep(value=""){const digits=sanitizeCep(value);if(digits.length!==8) return value||"";return `${digits.slice(0,5)}-${digits.slice(5)}`;}
  function escapeHtml(s=""){return s.replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
});
