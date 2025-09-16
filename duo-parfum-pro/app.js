/* ========= CONFIG FIREBASE ========= */
</div>`;
const [btnMinus, , btnPlus, btnDel] = row.querySelectorAll("button");
btnMinus.onclick = ()=> changeQty(item.id, -1);
btnPlus.onclick = ()=> changeQty(item.id, +1);
btnDel.onclick = ()=> removeItem(item.id);
els.cartItems.appendChild(row);
}
els.cartTotal.textContent = formatBRL(total);
els.cartCount.textContent = count;
}


async function confirmCheckout(){
const name = els.ckName.value.trim();
const cep = els.ckCep.value.trim();
const address = els.ckAddress.value.trim();
const payment = els.ckPayment.value;
if(!name || !cep || !address){ alert("Preencha Nome, CEP e Endereço."); return; }
const cart = state.cart; if(!cart.length){ alert("Carrinho vazio."); return; }


const total = cart.reduce((s,i)=> s+i.price*i.qty, 0);
const order = {
items: cart.map(i=>({ id:i.id,name:i.name,ml:i.ml||"",price:i.price,qty:i.qty })),
total,
createdAt: new Date(),
status: "pending",
customer: { name, cep, address, payment }
};


let orderId = "";
try{ const ref = await db.collection("orders").add(order); orderId = ref.id; }
catch(e){ console.error(e); alert("Não foi possível registrar o pedido."); return; }


const lines = cart.map(i=> `• ${i.name} (${i.ml||""}) x${i.qty} — ${formatBRL(i.price*i.qty)}`);
lines.push(`\nTotal: *${formatBRL(total)}*`);
lines.push(`\nCliente: ${name}\nCEP: ${cep}\nEndereço: ${address}\nPagamento: ${payment}`);
lines.push(`\nPedido nº: ${orderId}`);
const msg = encodeURIComponent(`Olá! Quero confirmar meu pedido:\n\n${lines.join("\n")}`);
const url = `https://wa.me/${WHATSAPP_PHONE}?text=${msg}`;
window.open(url, "_blank");


els.checkoutModal.close();
state.cart = []; saveCart(state.cart); updateCartUI();
}


/* ======= Helpers ======= */
function mapIds(ids){ const o={}; ids.forEach(id=> o[id]=document.getElementById(id)); return o; }
function toggle(el, hidden){ el.classList.toggle("hidden", hidden); }
function loadCart(){ try{return JSON.parse(localStorage.getItem("cart")||"[]");}catch{return []} }
function saveCart(v){ localStorage.setItem("cart", JSON.stringify(v)); }
function formatBRL(n){ return n?.toLocaleString?.("pt-BR",{style:"currency",currency:"BRL"}) ?? "R$ 0,00"; }
function sanitizeImg(src){ return src || "https://picsum.photos/seed/duoparfum/600/400"; }
function escapeHtml(s=""){ return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }


function seedFallback(){
const now = new Date();
return [
{id:"1",name:"La Vie Est Belle",brand:"Lancôme",price:549.9,ml:"100 ml",notes:"Gourmand floral.",category:"Importado",image:"",featured:true,stock:8,createdAt:now},
{id:"2",name:"Good Girl",brand:"Carolina Herrera",price:589.9,ml:"80 ml",notes:"Doce oriental.",category:"Importado",image:"",featured:true,stock:5,createdAt:now},
{id:"3",name:"212 VIP Men",brand:"Carolina Herrera",price:479.9,ml:"100 ml",notes:"Amadeirado especiado.",category:"Importado",image:"",featured:false,stock:7,createdAt:now},
{id:"4",name:"Quasar",brand:"O Boticário",price:169.9,ml:"100 ml",notes:"Aromático fresco.",category:"Nacional",image:"",featured:false,stock:12,createdAt:now},
{id:"5",name:"Decant Sauvage",brand:"Dior",price:59.9,ml:"10 ml",notes:"Cítrico aromático.",category:"Decant",image:"",featured:true,stock:30,createdAt:now}
]
}
});