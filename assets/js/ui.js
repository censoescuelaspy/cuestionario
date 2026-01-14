// Utilidades UI (modal, toast, helpers)

export function qs(sel, root=document){ return root.querySelector(sel); }
export function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

export function setNetBadge(isOnline){
  const x = qs("#netBadge");
  if (!x) return;
  x.textContent = isOnline ? "Online" : "Offline";
  x.classList.toggle("badge--online", !!isOnline);
  x.classList.toggle("badge--offline", !isOnline);
}


export function openModal(title, bodyHtml, actions){
  const modal = qs("#modal");
  qs("#modalTitle").textContent = title || "";
  qs("#modalBody").innerHTML = bodyHtml || "";
  const act = qs("#modalActions");
  act.innerHTML = "";
  (actions||[]).forEach(a => act.appendChild(a));
  modal.classList.add("modal--open");
}

export function closeModal(){
  const modal = qs("#modal");
  modal.classList.remove("modal--open");
  qs("#modalTitle").textContent = "";
  qs("#modalBody").innerHTML = "";
  qs("#modalActions").innerHTML = "";
}

export function btn(label, cls="btn", onClick=null){
  const b=document.createElement("button");
  b.className=cls;
  b.textContent=label;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function el(tag, cls, html){
  const x=document.createElement(tag);
  if (cls) x.className=cls;
  if (html!=null) x.innerHTML=html;
  return x;
}

export function safeText(s){
  return (s==null) ? "" : String(s);
}

export function debounce(fn, ms){
  let t=null;
  return (...args) => {
    clearTimeout(t);
    t=setTimeout(() => fn(...args), ms);
  };
}
