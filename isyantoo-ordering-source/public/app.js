const rupiah = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
let menu = [], cart = {};
const menuList = document.querySelector("#menu-list");
const cartList = document.querySelector("#cart-list");
async function loadMenu(){
  try{
    const r=await fetch("/api/menu"); if(!r.ok) throw new Error("Gagal memuat menu");
    menu=await r.json(); document.querySelector("#menu-count").textContent=`${menu.length} pilihan`;
    menuList.innerHTML=menu.map(x=>`<article class="food-card"><div class="food-emoji">${x.category==="Minuman"?"🥤":x.category==="Snack"?"🍞":"🍛"}</div><h3>${escapeHtml(x.name)}</h3><p>${escapeHtml(x.description||"Menu pilihan Isyantoo")}</p><div class="food-bottom"><span class="price">${rupiah(x.price)}</span><button class="small-btn" onclick="addToCart(${x.id})">+ Tambah</button></div></article>`).join("");
  }catch(e){menuList.textContent=e.message}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function addToCart(id){cart[id]=(cart[id]||0)+1;renderCart()}
function changeQty(id,delta){cart[id]=(cart[id]||0)+delta;if(cart[id]<=0)delete cart[id];renderCart()}
function renderCart(){
 const entries=Object.entries(cart); let total=0;
 if(!entries.length)cartList.textContent="Keranjang masih kosong.";
 else cartList.innerHTML=entries.map(([id,q])=>{const p=menu.find(x=>x.id===Number(id));if(!p)return "";total+=p.price*q;return `<div class="cart-item"><div><b>${escapeHtml(p.name)}</b><br><span class="muted">${rupiah(p.price)} × ${q}</span></div><div class="qty"><button type="button" onclick="changeQty(${id},-1)">−</button><b>${q}</b><button type="button" onclick="changeQty(${id},1)">+</button></div></div>`}).join("");
 document.querySelector("#cart-total").textContent=rupiah(total);
}
document.querySelector("#order-form").addEventListener("submit",async e=>{
 e.preventDefault();const msg=document.querySelector("#order-message");const items=Object.entries(cart).map(([id,quantity])=>({id:Number(id),quantity:Number(quantity)}));
 if(!items.length){msg.textContent="Tambahkan menu ke keranjang terlebih dahulu.";msg.className="message error";return}
 const data=Object.fromEntries(new FormData(e.target));data.items=items;
 try{const r=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error);msg.textContent=`Pesanan #${result.order_id} berhasil dikirim. Total ${rupiah(result.total)}.`;msg.className="message success";cart={};renderCart();e.target.reset()}catch(err){msg.textContent=err.message;msg.className="message error"}
});
document.querySelector("#year").textContent=new Date().getFullYear();
loadMenu();
