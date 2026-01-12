import { qs, el, safeText } from "./ui.js";

export async function loadSchema(moduleId){
  const res = await fetch(`schemas/${moduleId}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar el esquema: " + moduleId);
  return res.json();
}

function evalCond(cond, answers){
  const v = answers[cond.q];
  if (cond.op === "eq") return v === cond.value;
  if (cond.op === "neq") return v !== cond.value;
  if (cond.op === "in"){
    const arr = cond.values || [];
    return arr.includes(v);
  }
  return true;
}

export function isVisible(item, answers){
  if (!item.show_if || item.show_if.length===0) return true;
  // AND de condiciones
  return item.show_if.every(c => evalCond(c, answers));
}

function renderInput(item, answers, onChange){
  const qtype = item.qtype || "text";
  const code = item.code;
  const value = answers[code];

  if (qtype === "radio"){
    const wrap = el("div", "");
    (item.options || []).forEach((opt, idx) => {
      const id = `r_${code}_${idx}`;
      const row = el("label", "opt");
      const inp = document.createElement("input");
      inp.type = "radio";
      inp.name = `radio_${code}`;
      inp.id = id;
      inp.value = opt;
      inp.checked = (value === opt);
      inp.addEventListener("change", () => onChange(code, opt));
      const span = el("span","", safeText(opt));
      row.appendChild(inp);
      row.appendChild(span);
      wrap.appendChild(row);
    });
    return wrap;
  }

  if (qtype === "checkbox"){
    const wrap = el("div", "");
    const arr = Array.isArray(value) ? value : [];
    (item.options || []).forEach((opt, idx) => {
      const id = `c_${code}_${idx}`;
      const row = el("label", "opt");
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.id = id;
      inp.value = opt;
      inp.checked = arr.includes(opt);
      inp.addEventListener("change", () => {
        const next = new Set(arr);
        if (inp.checked) next.add(opt); else next.delete(opt);
        onChange(code, Array.from(next));
      });
      const span = el("span","", safeText(opt));
      row.appendChild(inp);
      row.appendChild(span);
      wrap.appendChild(row);
    });
    return wrap;
  }

  if (qtype === "textarea"){
    const ta = document.createElement("textarea");
    ta.className = "input";
    ta.value = value != null ? String(value) : "";
    ta.addEventListener("input", () => onChange(code, ta.value));
    return ta;
  }

  if (qtype === "number"){
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "any";
    inp.className = "input";
    inp.value = (value != null && value !== "") ? String(value) : "";
    inp.addEventListener("input", () => {
      const v = inp.value;
      onChange(code, v === "" ? "" : Number(v));
    });
    return inp;
  }

  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "input";
  inp.value = value != null ? String(value) : "";
  inp.addEventListener("input", () => onChange(code, inp.value));
  return inp;
}

export function renderForm(schema, state){
  const root = el("div","grid","");
  const answers = state.answers || {};

  const onChange = (code, v) => {
    answers[code] = v;
    state.answers = answers;
    // re-render visibilidad
    const items = root.querySelectorAll("[data-item-code]");
    items.forEach(node => {
      const code = node.getAttribute("data-item-code");
      const item = schema.items.find(x => x.type==="question" && x.code===code);
      if (!item) return;
      node.classList.toggle("hidden", !isVisible(item, answers));
    });
    // controlar requeridos: solo se valida al guardar
  };

  schema.items.forEach(item => {
    if (item.type === "section"){
      root.appendChild(el("div","sectionTitle", safeText(item.code) + " - " + safeText(item.text)));
      return;
    }
    const box = el("div","item","");
    box.setAttribute("data-item-code", item.code);

    const top = el("div","item__top","");
    const left = el("div","");
    left.appendChild(el("div","code", safeText(item.code)));
    left.appendChild(el("div","", `<div class="h2">${safeText(item.text)}</div>`));
    top.appendChild(left);
    box.appendChild(top);

    const input = renderInput(item, answers, onChange);
    box.appendChild(input);

    if (item.help){
      box.appendChild(el("div","help", safeText(item.help)));
    }

    box.classList.toggle("hidden", !isVisible(item, answers));
    root.appendChild(box);
  });

  return root;
}
