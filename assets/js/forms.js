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
  const value = (answers && Object.prototype.hasOwnProperty.call(answers, code)) ? answers[code] : null;

  // helpers
  const setVal = (v) => { onChange(code, v); };

  if (qtype === "radio"){
    const opts = (item.options || []).map(x => String(x));
    // Para pocas opciones, usar botones segmentados (mejor UX en móvil)
    if (opts.length > 0 && opts.length <= 6){
      const wrap = el("div","segmented","");
      opts.forEach(opt => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "segbtn" + (String(value) === opt ? " is-active" : "");
        b.textContent = opt;
        b.addEventListener("click", () => {
          setVal(opt);
          // estado visual
          Array.from(wrap.querySelectorAll(".segbtn")).forEach(x => x.classList.remove("is-active"));
          b.classList.add("is-active");
        });
        wrap.appendChild(b);
      });
      return wrap;
    }

    // fallback: radio clásico
    const wrap = el("div","");
    opts.forEach((opt, idx) => {
      const id = `r_${code}_${idx}`;
      const row = el("label","radio","");
      const inp = document.createElement("input");
      inp.type="radio";
      inp.name=code;
      inp.value=opt;
      inp.checked = (String(value) === opt);
      inp.addEventListener("change", () => setVal(opt));
      row.appendChild(inp);
      row.appendChild(el("span","", opt));
      wrap.appendChild(row);
    });
    return wrap;
  }

  if (qtype === "select"){
    const sel = document.createElement("select");
    sel.className="input";
    const opt0 = document.createElement("option");
    opt0.value="";
    opt0.textContent="(Seleccione)";
    sel.appendChild(opt0);
    (item.options || []).forEach(opt => {
      const o = document.createElement("option");
      o.value = String(opt);
      o.textContent = String(opt);
      if (String(value) === String(opt)) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => setVal(sel.value || null));
    return sel;
  }

  if (qtype === "checkbox"){
    // multi-selección -> array
    const cur = Array.isArray(value) ? value.map(String) : [];
    const wrap = el("div","chkgrid","");
    (item.options || []).forEach((opt, idx) => {
      const id = `c_${code}_${idx}`;
      const row = el("label","check","");
      const inp = document.createElement("input");
      inp.type="checkbox";
      inp.value=String(opt);
      inp.checked = cur.includes(String(opt));
      inp.addEventListener("change", () => {
        const now = new Set(cur);
        if (inp.checked) now.add(String(opt)); else now.delete(String(opt));
        setVal(Array.from(now));
      });
      row.appendChild(inp);
      row.appendChild(el("span","", String(opt)));
      wrap.appendChild(row);
    });
    return wrap;
  }

  if (qtype === "number"){
    const inp = document.createElement("input");
    inp.type="number";
    inp.className="input";
    inp.value = (value==null) ? "" : String(value);
    if (item.min != null) inp.min = String(item.min);
    if (item.max != null) inp.max = String(item.max);
    inp.addEventListener("input", () => {
      const v = inp.value;
      setVal(v === "" ? null : Number(v));
    });
    return inp;
  }

  if (qtype === "textarea"){
    const ta = document.createElement("textarea");
    ta.className="input";
    ta.rows = item.rows || 3;
    ta.value = (value==null) ? "" : String(value);
    ta.addEventListener("input", () => setVal(ta.value));
    return ta;
  }

  // default: text
  const inp = document.createElement("input");
  inp.type="text";
  inp.className="input";
  inp.value = (value==null) ? "" : String(value);
  inp.addEventListener("input", () => setVal(inp.value));
  return inp;
}


export function renderForm(schema, state){
  const root = el("div","form","");
  const answers = state.answers || {};

  const onChange = (code, v) => {
    answers[code] = v;
    state.answers = answers;
    // re-render visibilidad (sin reconstruir todo el DOM)
    const nodes = root.querySelectorAll("[data-item-code]");
    nodes.forEach(node => {
      const c = node.getAttribute("data-item-code");
      const item = schema.items.find(x => x.type==="question" && x.code===c);
      if (!item) return;
      node.classList.toggle("hidden", !isVisible(item, answers));
    });
  };

  // Agrupar por secciones: cada item.type === "section" inicia un contenedor colapsable
  let sectionBody = null;
  let sectionN = 0;

  const openFirst = () => (sectionN === 1);

  const makeSection = (title) => {
    sectionN++;
    const det = document.createElement("details");
    det.className = "section";
    det.open = openFirst();
    const sum = document.createElement("summary");
    sum.textContent = title;
    det.appendChild(sum);
    const body = el("div","sectionBody","");
    det.appendChild(body);
    root.appendChild(det);
    return body;
  };

  // Si el formulario no define secciones, crear una por defecto
  sectionBody = makeSection("Formulario");

  schema.items.forEach(item => {
    if (item.type === "section"){
      const title = safeText(item.code) + " - " + safeText(item.text);
      sectionBody = makeSection(title);
      return;
    }
    if (item.type !== "question") return;

    const box = el("div","item","");
    box.setAttribute("data-item-code", item.code);

    const top = el("div","item__top","");
    const left = el("div","");
    left.appendChild(el("div","code", safeText(item.code)));
    left.appendChild(el("div","", `<div class="h2">${safeText(item.text)}</div>`));
    top.appendChild(left);

    const req = el("div","req", (item.required ? "Obligatorio" : ""));
    top.appendChild(req);

    box.appendChild(top);

    const input = renderInput(item, answers, onChange);
    box.appendChild(input);

    if (item.help){
      box.appendChild(el("div","help", safeText(item.help)));
    }
    if (item.note){
      box.appendChild(el("div","note", safeText(item.note)));
    }

    box.classList.toggle("hidden", !isVisible(item, answers));
    sectionBody.appendChild(box);
  });

  return root;
}

