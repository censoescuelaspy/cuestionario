import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { enqueue, getAll, remove, count as qCount } from "./offline_queue.js";
import { qs, el, btn, openModal, closeModal, setNetBadge, debounce, safeText } from "./ui.js";

function mainRoot(){ return qs("#mainContent") || qs("#appRoot"); }
function sideRoot(){ return qs("#sideRoot"); }
function setMode(isLogged){
  document.body.classList.toggle("mode-login", !isLogged);
  document.body.classList.toggle("mode-app", !!isLogged);
}
function closeNav(){ document.body.classList.remove("nav-open"); }

import { loadSchema, renderForm } from "./forms.js";

const STORAGE_KEY = "sidie_state_v1";

const MODULES = [
  { id: "general", label: "General (Local)" },
  { id: "servicios", label: "Servicios básicos (Local)" },
  { id: "exteriores", label: "Áreas exteriores (Local)" },
  { id: "bloques_niveles", label: "Bloques y niveles (Por bloque)" },
  { id: "areas_recreacion", label: "Áreas de recreación sin techo (Por área)" },
  { id: "aulas", label: "Aulas (Por aula)" },
  { id: "dependencias", label: "Dependencias (Por dependencia)" },
  { id: "laboratorios", label: "Laboratorios (Por laboratorio)" },
  { id: "talleres", label: "Talleres (Por taller)" },
  { id: "sanitarios", label: "Sanitarios (Por sanitario)" }
];

function uuid(){
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random()*16|0;
    const v = c === "x" ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}

function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultState(){
  return {
    device_id: uuid(),
    token: null,
    user: null,
    visit_id: null,
    school: null, // { CODIGO, NOMBRE, DEPTO, DIST, ... }
    assigned: [], // escuelas asignadas al usuario
    assigned_loaded_at: null,
    records: {}   // module_id -> { entity_id -> { answers:{}, photos:[] } }
  };
}

function ensureRecord(state, moduleId, entityId){
  if (!state.records[moduleId]) state.records[moduleId] = {};
  if (!state.records[moduleId][entityId]){
    state.records[moduleId][entityId] = { answers: {}, photos: [] };
  }
  return state.records[moduleId][entityId];
}


async function ensureAssigned(state){
  // Carga lista de escuelas asignadas al usuario (cacheada en localStorage)
  if (state.assigned && state.assigned.length > 0) return;
  if (!state.token) return;
  if (!navigator.onLine) return;
  try{
    const data = await api.assignedList(state.token, "", 200);
    state.assigned = (data.results || []).map(x => ({
      CODIGO: String(x.CODIGO||"").trim(),
      NOMBRE: String(x.NOMBRE||"").trim(),
      DEPTO: String(x.DEPTO||"").trim(),
      DIST: String(x.DIST||"").trim(),
      ZONA: String(x.ZONA||"").trim(),
      LOCALIDAD: String(x.LOCALIDAD||"").trim(),
      ESTRATO: String(x.ESTRATO||"").trim(),
      GRUPO_MATRICULA: String(x.GRUPO_MATRICULA||"").trim(),
      MATRICULA: x.MATRICULA
    })).filter(x => x.CODIGO);
    state.assigned_loaded_at = Date.now();
    saveState(state);
  }catch(e){
    // si falla, no interrumpir. La selección podrá funcionar con búsqueda online por q.
  }
}

function setUserUI(state){
  const userBox = qs("#userBox");
  const userLabel = qs("#userLabel");
  if (state.user){
    userBox.hidden = false;
    userLabel.textContent = state.user.user + " (" + state.user.email + ")";
  } else {
    userBox.hidden = true;
    userLabel.textContent = "";
  }
}

async function updateQueueUI(){
  const n = await qCount();
  qs("#queueInfo").textContent = "Pendientes: " + n;
  qs("#btnSync").disabled = (n === 0);
}

function toast(msg, kind="info"){
  const t = qs("#toast");
  if (!t){
    openModal("Aviso", `<div class="muted">${safeText(msg)}</div>`, [
      btn("Cerrar","btn btn--light", () => closeModal())
    ]);
    return;
  }
  t.textContent = String(msg || "");
  t.classList.remove("toast--info","toast--ok","toast--warn","toast--err","toast--show");
  if (kind === "ok") t.classList.add("toast--ok");
  else if (kind === "warn") t.classList.add("toast--warn");
  else if (kind === "err") t.classList.add("toast--err");
  t.classList.add("toast--show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove("toast--show","toast--ok","toast--warn","toast--err");
  }, 2600);
}


function normalizeLatLng(val){
  if (val==null) return null;
  if (typeof val === "number") return val;
  const s = String(val).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function renderLogin(state){
  setMode(false);
  const root = mainRoot();
  if (root) root.innerHTML = "";

  const card = el("div","card","");
  card.appendChild(el("div","h1","Ingreso al sistema"));
  card.appendChild(el("div","muted","Autenticación contra la hoja 'usuarios' del libro. La sesión se guarda localmente en este dispositivo."));

  const row = el("div","grid grid--2","");
  const left = el("div","","");
  const right = el("div","","");

  left.appendChild(el("div","label","Usuario"));
  const u = document.createElement("input");
  u.className = "input";
  u.autocomplete = "username";
  u.placeholder = "usuario";
  u.value = (loadState() && loadState().user && loadState().user.user) ? loadState().user.user : "";
  left.appendChild(u);

  right.appendChild(el("div","label","Contraseña"));
  const p = document.createElement("input");
  p.className = "input";
  p.type = "password";
  p.autocomplete = "current-password";
  p.placeholder = "********";
  right.appendChild(p);

  row.appendChild(left);
  row.appendChild(right);
  card.appendChild(row);

  const showRow = el("div","kpi","");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = "showPass";
  const lb = document.createElement("label");
  lb.setAttribute("for","showPass");
  lb.textContent = "Mostrar contraseña";
  lb.style.cursor = "pointer";
  lb.style.userSelect = "none";
  showRow.appendChild(cb);
  showRow.appendChild(lb);
  card.appendChild(showRow);
  cb.addEventListener("change", () => { p.type = cb.checked ? "text" : "password"; });

  const actions = el("div","btnrow sticky","");
  const b = btn("Ingresar","btn", async () => {
    try{
      const user = u.value.trim();
      const pass = p.value;
      if (!user || !pass){ toast("Complete usuario y contraseña.", "warn"); return; }
      const r = await api.login(user, pass);
      state.token = r.token;
      state.user = r.user;
      saveState(state);
      toast("Sesión iniciada.", "ok");
      await bootstrap(state);
    }catch(e){
      toast(e.message || "Error de autenticación.", "err");
    }
  });
  actions.appendChild(b);
  card.appendChild(actions);

  if (root) root.appendChild(card);
}


async function renderSchoolSelector(state){
  const card = el("div","card","");
  card.appendChild(el("div","h1","Escuela asignada"));
  card.appendChild(el("div","muted","El catálogo está restringido a las escuelas asignadas al usuario (columna USUARIO en la hoja escuelas_muestra)."));

  const kp = el("div","kpi","");
  kp.appendChild(el("div","kpi__pill", "Dispositivo: " + safeText(state.device_id)));
  if (state.user && state.user.user) kp.appendChild(el("div","kpi__pill", "Usuario: " + safeText(state.user.user)));
  card.appendChild(kp);

  // filtros
  const filt = el("div","","");
  filt.appendChild(el("div","label","Filtros (opcional)"));
  const frow = el("div","grid grid--2","");
  const sDept = document.createElement("select");
  const sDist = document.createElement("select");
  sDept.innerHTML = "<option value=''>Todos los departamentos</option>";
  sDist.innerHTML = "<option value=''>Todos los distritos</option>";
  frow.appendChild(sDept);
  frow.appendChild(sDist);
  filt.appendChild(frow);
  card.appendChild(filt);

  // selector principal
  card.appendChild(el("div","label","Buscar por CUE o nombre (asignados)"));
  const inp = document.createElement("input");
  inp.className = "input";
  inp.placeholder = "Ej: 1006058 o ESPÍRITU SANTO";
  inp.setAttribute("list","schoolsList");
  card.appendChild(inp);

  const dl = document.createElement("datalist");
  dl.id = "schoolsList";
  card.appendChild(dl);

  const meta = el("div","muted2","");
  card.appendChild(meta);

  const uniq = (arr) => Array.from(new Set(arr.filter(x => x != null && String(x).trim() !== "").map(x => String(x).trim()))).sort();

  const all = Array.isArray(state.assigned) ? state.assigned : [];
  const depts = uniq(all.map(x => x.DEPTO));
  depts.forEach(d => {
    const o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    sDept.appendChild(o);
  });

  const refreshDist = () => {
    const dsel = sDept.value || "";
    const ds = uniq(all.filter(x => !dsel || String(x.DEPTO||"").trim() === dsel).map(x => x.DIST));
    sDist.innerHTML = "<option value=''>Todos los distritos</option>";
    ds.forEach(d => {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = d;
      sDist.appendChild(o);
    });
  };

  const filtered = () => {
    const dsel = sDept.value || "";
    const disel = sDist.value || "";
    return all.filter(x => (!dsel || String(x.DEPTO||"").trim() === dsel) && (!disel || String(x.DIST||"").trim() === disel));
  };

  const refreshList = () => {
    dl.innerHTML = "";
    const rows = filtered();
    rows.forEach(r => {
      const opt = document.createElement("option");
      const cue = String(r.CODIGO || "").trim();
      const nom = String(r.NOMBRE || "").trim();
      opt.value = (cue ? cue + " - " : "") + nom;
      dl.appendChild(opt);
    });
  };

  const setSchoolMeta = () => {
    if (!state.school){
      meta.textContent = "Seleccione una escuela para habilitar el registro de módulos.";
      return;
    }
    const s = state.school;
    const maps = (s.LAT_DEC && s.LNG_DEC)
      ? `<a target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${encodeURIComponent(String(s.LAT_DEC)+","+String(s.LNG_DEC))}">Abrir en Maps</a>`
      : "";
    meta.innerHTML = `
      <div><span class="tag">CUE</span> ${safeText(s.CODIGO || "-")}</div>
      <div><span class="tag">NOMBRE</span> ${safeText(s.NOMBRE || "-")}</div>
      <div><span class="tag">DEPTO</span> ${safeText(s.DEPTO || "-")}</div>
      <div><span class="tag">DIST</span> ${safeText(s.DIST || "-")}</div>
      <div><span class="tag">ZONA</span> ${safeText(s.ZONA || "-")}</div>
      <div><span class="tag">LOCALIDAD</span> ${safeText(s.LOCALIDAD || "-")}</div>
      <div class="muted2" style="margin-top:8px">${maps}</div>
    `;
  };

  sDept.addEventListener("change", () => {
    refreshDist();
    refreshList();
    inp.value = "";
  });
  sDist.addEventListener("change", () => {
    refreshList();
    inp.value = "";
  });

  inp.addEventListener("change", async () => {
    const raw = inp.value || "";
    const cue = raw.split(" - ")[0].trim();
    const byCue = filtered().find(x => String(x.CODIGO || "").trim() === cue);
    const pick = byCue || filtered().find(x => String(x.NOMBRE || "").trim().toLowerCase() === raw.trim().toLowerCase());
    if (!pick){
      toast("No se encontró una escuela asignada con ese criterio.", "warn");
      return;
    }
    // Traer versión completa por API (mantiene compatibilidad)
    try{
      const r = await api.schoolGet(state.token, String(pick.CODIGO || "").trim());
      state.school = r.school || pick;
      if (!state.visit_id) state.visit_id = uuid();
      saveState(state);
      toast("Escuela seleccionada.", "ok");
      setSchoolMeta();
    }catch(e){
      state.school = pick;
      if (!state.visit_id) state.visit_id = uuid();
      saveState(state);
      toast("Escuela seleccionada (modo local).", "warn");
      setSchoolMeta();
    }
  });

  refreshDist();
  refreshList();
  setSchoolMeta();

  return card;
}


async function renderModuleList(state, onOpen){
  const card = el("div","card","");
  card.appendChild(el("div","h1","Módulos de relevamiento"));
  card.appendChild(el("div","muted","Abra un módulo para registrar información. Para módulos por unidad, use identificadores operativos consistentes (por ejemplo BLOQUE_A, AULA_01)."));

  const searchWrap = el("div","navsearch","");
  const s = document.createElement("input");
  s.className = "input";
  s.placeholder = "Buscar módulo...";
  searchWrap.appendChild(s);
  card.appendChild(searchWrap);

  const list = el("div","navlist","");

  const icon = (id) => {
    const map = {
      general: "🏫",
      servicios: "💧",
      exteriores: "🌳",
      bloques_niveles: "🧱",
      areas_recreacion: "🏟️",
      aulas: "📚",
      dependencias: "🚪",
      laboratorios: "🧪",
      talleres: "🛠️",
      sanitarios: "🚻"
    };
    return map[id] || "📄";
  };

  const makeItem = (m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "navitem";
    b.setAttribute("data-module-id", m.id);

    const n = (state.records && state.records[m.id]) ? Object.keys(state.records[m.id]).length : 0;

    b.innerHTML = `
      <div class="navitem__icon" aria-hidden="true">${icon(m.id)}</div>
      <div class="navitem__main">
        <div class="navitem__title">${safeText(m.label)}</div>
        <div class="navitem__meta">Registros locales: ${n}</div>
      </div>
      <div class="navitem__pill">${n > 0 ? "En curso" : "Nuevo"}</div>
    `;

    b.addEventListener("click", () => {
      closeNav();
      onOpen(m.id);
      // marcar activo
      list.querySelectorAll(".navitem").forEach(x => x.classList.remove("is-active"));
      b.classList.add("is-active");
    });
    return b;
  };

  MODULES.forEach(m => list.appendChild(makeItem(m)));
  card.appendChild(list);

  s.addEventListener("input", () => {
    const q = s.value.trim().toLowerCase();
    list.querySelectorAll(".navitem").forEach(btn => {
      const txt = btn.textContent.toLowerCase();
      btn.style.display = (!q || txt.includes(q)) ? "" : "none";
    });
  });

  return card;
}


function pickEntityUI(schema, state, moduleId, onPick){
  const entityType = schema.entity_type || "LOCAL";
  if (entityType === "LOCAL"){
    return { entityId: "LOCAL", node: el("div","", "") };
  }
  const wrap = el("div","item","");
  wrap.appendChild(el("div","h2", "Unidad de registro (" + entityType + ")"));
  wrap.appendChild(el("div","muted","Use un identificador operativo, por ejemplo BLOQUE_A, AULA_01, SANITARIO_2."));

  const row = el("div","grid grid--2","");
  const left = el("div","");
  left.appendChild(el("div","label","Identificador"));
  const inp = document.createElement("input");
  inp.className="input";
  inp.placeholder="Ej: AULA_01";
  left.appendChild(inp);

  const right = el("div","");
  right.appendChild(el("div","label","Registros existentes"));
  const sel = document.createElement("select");
  sel.className="input";
  const opt0 = document.createElement("option");
  opt0.value=""; opt0.textContent="(Seleccione)";
  sel.appendChild(opt0);
  const existing = state.records[moduleId] ? Object.keys(state.records[moduleId]) : [];
  existing.forEach(id => {
    const o=document.createElement("option");
    o.value=id; o.textContent=id;
    sel.appendChild(o);
  });
  right.appendChild(sel);

  row.appendChild(left);
  row.appendChild(right);
  wrap.appendChild(row);

  const actions = el("div","btnrow sticky","");
  const bNew = btn("Crear / Abrir","btn btn--light", () => {
    const id = inp.value.trim() || sel.value;
    if (!id) { toast("Defina o seleccione un identificador."); return; }
    onPick(id);
  });
  actions.appendChild(bNew);
  wrap.appendChild(actions);

  return { entityId: null, node: wrap };
}

async function moduleScreen(state, moduleId){
  closeNav();
  const root = mainRoot();
  if (root) root.innerHTML = "";

  const schema = await loadSchema(moduleId);

  const head = el("div","card","");
  head.appendChild(el("div","h1", safeText(schema.title || moduleId)));
  head.appendChild(el("div","muted","Escuela: " + safeText(state.school ? state.school.NOMBRE : "(sin seleccionar)") + " (CUE: " + safeText(state.school ? state.school.CODIGO : "-") + ")"));
  const bRow = el("div","btnrow","");
  bRow.appendChild(btn("Volver al panel","btn btn--light", () => bootstrap(state)));
  head.appendChild(bRow);

  if (root) root.appendChild(head);

  if (!state.school){
    const warn = el("div","card","");
    warn.appendChild(el("div","h1","Seleccione una escuela"));
    warn.appendChild(el("div","muted","Antes de capturar módulos, seleccione una escuela del catálogo asignado."));
    warn.appendChild(btn("Ir a selección","btn", () => bootstrap(state)));
    if (root) root.appendChild(warn);
    return;
  }

  const entityPicker = pickEntityUI(schema, state, moduleId, async (entityId) => {
    await moduleForm(state, schema, moduleId, entityId);
  });

  if (schema.entity_type !== "LOCAL"){
    if (root) root.appendChild(entityPicker.node);
  } else {
    await moduleForm(state, schema, moduleId, "LOCAL");
  }
}


async function moduleForm(state, schema, moduleId, entityId){
  const root = qs("#appRoot");
  // eliminar formularios anteriores
  const existing = qs("#moduleFormCard");
  if (existing) existing.remove();

  const rec = ensureRecord(state, moduleId, entityId);

  const card = el("div","card","");
  card.id="moduleFormCard";
  card.appendChild(el("div","h1", "Formulario: " + safeText(schema.title || moduleId)));
  card.appendChild(el("div","muted", "Unidad: " + safeText(entityId) + ", Escuela CUE: " + safeText(state.school.CODIGO)));

  const formState = { answers: rec.answers };
  const form = renderForm(schema, formState);
  card.appendChild(form);

  // Evidencias (fotos)
  const photoBox = el("div","item","");
  photoBox.appendChild(el("div","h2","Evidencias fotográficas"));
  photoBox.appendChild(el("div","muted","Adjunte fotos representativas. Evite capturar rostros o documentos con datos personales visibles."));
  const inp = document.createElement("input");
  inp.type="file";
  inp.accept="image/*";
  inp.multiple=true;
  inp.className="input";
  photoBox.appendChild(inp);

  const photoList = el("div","grid","");
  const refreshPhotoList = () => {
    photoList.innerHTML="";
    (rec.photos || []).forEach(ph => {
      const row = el("div","item","");
      row.innerHTML = `
        <div class="item__top">
          <div>
            <div class="h2">${safeText(ph.name || "Foto")}</div>
            <div class="muted">${safeText(ph.status || "")}</div>
            ${ph.url ? `<div class="muted">URL: <span class="code">${safeText(ph.url)}</span></div>` : ""}
          </div>
        </div>
      `;
      photoList.appendChild(row);
    });
    if ((rec.photos||[]).length===0){
      photoList.appendChild(el("div","muted","Sin fotos adjuntas."));
    }
  };
  refreshPhotoList();
  photoBox.appendChild(photoList);
  card.appendChild(photoBox);

  inp.addEventListener("change", async () => {
    const files = Array.from(inp.files || []);
    if (files.length===0) return;
    for (const f of files){
      const mb = f.size / (1024*1024);
      const entry = { name: f.name, status: "Pendiente", url: null };
      rec.photos.push(entry);
      refreshPhotoList();

      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      });

      const payload = {
        visit_id: state.visit_id,
        module_id: moduleId,
        entity_type: schema.entity_type,
        entity_id: entityId,
        codigo: state.school.CODIGO,
        file_name: f.name,
        content_type: f.type || "image/jpeg",
        data_url: dataUrl,
        size_bytes: f.size
      };

      if (!navigator.onLine){
        entry.status = "En cola (offline)";
        await enqueue({ type: "photo", payload });
        refreshPhotoList();
        await updateQueueUI();
        continue;
      }
      try{
        const resp = await api.uploadPhoto(state.token, payload);
        entry.status = "Cargada";
        entry.url = resp.url;
        refreshPhotoList();
      }catch(e){
        entry.status = "En cola (error de red)";
        await enqueue({ type: "photo", payload });
        refreshPhotoList();
        await updateQueueUI();
      }
    }
    saveState(state);
    inp.value="";
  });

  const actions = el("div","btnrow sticky","");

  const clearInvalid = () => {
    const bad = form.querySelectorAll(".invalid");
    bad.forEach(n => n.classList.remove("invalid"));
    const hints = form.querySelectorAll(".invalid-hint");
    hints.forEach(n => n.remove());
  };

  const isEmptyAns = (v) => {
    if (v === undefined || v === null) return true;
    if (Array.isArray(v)) return v.length === 0;
    const s = String(v);
    return s.trim().length === 0;
  };

  const validateRequired = () => {
    clearInvalid();
    const answers = formState.answers || {};
    const missing = [];
    schema.items.forEach(it => {
      if (it.type !== "question") return;
      const node = form.querySelector(`[data-item-code="${it.code}"]`);
      const isHidden = node && node.classList.contains("hidden");
      if (isHidden) return;
      if (isEmptyAns(answers[it.code])){
        missing.push(it);
        if (node){
          node.classList.add("invalid");
          node.appendChild(el("div","invalid-hint","Campo obligatorio."));
        }
      }
    });
    if (missing.length){
      const first = form.querySelector(`[data-item-code="${missing[0].code}"]`);
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      toast(`Faltan ${missing.length} respuestas obligatorias. Complete los campos marcados.`, "warn");
      return false;
    }
    return true;
  };

  const bDraft = btn("Guardar borrador","btn btn--light", async () => {
    rec.answers = formState.answers || {};
    saveState(state);
    toast("Borrador guardado en el dispositivo.", "ok");
  });

  const bSend = btn("Validar y enviar","btn btn--primary", async () => {
    // Validar obligatorios en el cliente (solo ítems visibles)
    if (!validateRequired()) return;

    const answers = formState.answers || {};
    // filtrar solo ítems visibles
    const visible = {};
    schema.items.forEach(it => {
      if (it.type!=="question") return;
      const node = form.querySelector(`[data-item-code="${it.code}"]`);
      const isHidden = node && node.classList.contains("hidden");
      if (isHidden) return;
      if (answers[it.code] !== undefined) visible[it.code] = answers[it.code];
    });

    rec.answers = answers;
    saveState(state);

    const payload = {
      visit_id: state.visit_id,
      device_id: state.device_id,
      module_id: schema.module_id,
      entity_type: schema.entity_type,
      entity_id: entityId,
      school: state.school,
      answers: visible,
      client_ts: new Date().toISOString(),
      offline: !navigator.onLine
    };

    if (!navigator.onLine){
      await enqueue({ type: "submit", payload });
      await updateQueueUI();
      toast("Sin conexión: envío guardado en cola.", "warn");
      return;
    }

    try{
      await api.submit(state.token, payload);
      toast("Envío realizado correctamente.", "ok");
    }catch(e){
      // si falla en online, encolar
      await enqueue({ type: "submit", payload });
      await updateQueueUI();
      toast("No se pudo enviar. Se guardó en cola para sincronizar.", "warn");
    }
  });

  actions.appendChild(bDraft);
  actions.appendChild(bSend);
  const bReset = btn("Limpiar módulo","btn btn--danger", () => {
    openModal("Confirmación", "<div class='muted'>¿Desea limpiar las respuestas de este módulo en este dispositivo? Esta acción no borra lo ya sincronizado.</div>", [
      btn("Cancelar","btn btn--light", () => closeModal()),
      btn("Limpiar","btn btn--danger", () => {
        rec.answers = {};
        rec.photos = [];
        saveState(state);
        moduleScreen(state, moduleId);
        closeModal();
      })
    ]);
  });
  actions.appendChild(bReset);

  card.appendChild(actions);
  root.appendChild(card);
}

async function syncQueue(state){
  if (!navigator.onLine){ toast("Sin conexión. Intente nuevamente cuando esté online."); return; }
  if (!state.token){ toast("Sesión no válida."); return; }

  const items = await getAll();
  if (items.length===0){ await updateQueueUI(); return; }

  let ok=0, fail=0;
  for (const it of items){
    try{
      if (it.type === "submit"){
        await api.submit(state.token, it.payload);
        await remove(it.id);
        ok++;
      } else if (it.type === "photo"){
        await api.uploadPhoto(state.token, it.payload);
        await remove(it.id);
        ok++;
      } else {
        await remove(it.id);
      }
    }catch(e){
      fail++;
      // mantener en cola
    }
  }
  await updateQueueUI();
  toast(`Sincronización finalizada. Enviados: ${ok}, Pendientes: ${fail}.`);
}

async 
function renderHome(state){
  const card = el("div","card","");
  card.appendChild(el("div","h1","Panel operativo"));
  const msg = el("div","muted",
    "Seleccione una escuela asignada en el panel lateral y luego abra los módulos. " +
    "Guarde localmente en cada módulo. Si está sin conexión, los envíos quedarán en cola y podrá sincronizar más tarde."
  );
  card.appendChild(msg);

  const kp = el("div","kpi","");
  kp.appendChild(el("div","kpi__pill", "Dispositivo: " + safeText(state.device_id)));
  kp.appendChild(el("div","kpi__pill", "Pendientes: " + String((loadQueueCount && loadQueueCount()) || 0)));
  if (state.user && state.user.user){
    kp.appendChild(el("div","kpi__pill", "Usuario: " + safeText(state.user.user)));
  }
  card.appendChild(kp);

  const school = el("div","card","");
  school.appendChild(el("div","h1","Escuela activa"));
  const body = el("div","muted2","");
  if (state.school){
    const maps = (state.school.LAT_DEC && state.school.LNG_DEC)
      ? `<a target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${encodeURIComponent(String(state.school.LAT_DEC)+","+String(state.school.LNG_DEC))}">Abrir en Maps</a>`
      : "";
    body.innerHTML = `
      <div><span class="tag">CUE</span> ${safeText(state.school.CODIGO || "-")}</div>
      <div><span class="tag">NOMBRE</span> ${safeText(state.school.NOMBRE || "-")}</div>
      <div><span class="tag">DEPTO</span> ${safeText(state.school.DEPTO || "-")}</div>
      <div><span class="tag">DIST</span> ${safeText(state.school.DIST || "-")}</div>
      <div class="muted2" style="margin-top:8px">${maps}</div>
    `;
  } else {
    body.textContent = "Aún no se seleccionó escuela.";
  }
  school.appendChild(body);

  const wrap = el("div","grid grid--2","");
  // Si grid no existe en CSS, mantiene legible por block
  wrap.appendChild(card);
  wrap.appendChild(school);

  const out = el("div","","");
  out.appendChild(wrap);
  return out;
}
async function bootstrap(state){
  setUserUI(state);
  setMode(true);

  const main = mainRoot();
  if (main) main.innerHTML = "";

  const side = sideRoot();
  if (side) side.innerHTML = "";

  await ensureAssigned(state);

  const selector = await renderSchoolSelector(state);
  const moduleList = await renderModuleList(state, (moduleId) => moduleScreen(state, moduleId));

  if (side){
    side.appendChild(selector);
    side.appendChild(moduleList);
  } else if (main){
    // fallback legacy layout
    main.appendChild(selector);
    main.appendChild(moduleList);
  }

  if (main){
    main.appendChild(renderHome(state));
  }

  await updateQueueUI();
}


async function main(){
  const navBtn = qs("#btnNav");
  const scrim = qs("#scrim");
  if (navBtn){ navBtn.addEventListener("click", () => document.body.classList.toggle("nav-open")); }
  if (scrim){ scrim.addEventListener("click", () => closeNav()); }

  // Service worker
  if ("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){}
  }

  let state = loadState() || defaultState();
  if (!state.device_id) state.device_id = uuid();
  if (!state.visit_id) state.visit_id = uuid();
  saveState(state);

  setNetBadge(navigator.onLine);
  window.addEventListener("online", async () => { setNetBadge(true); toast("Conexión restablecida, intentando sincronizar cola.", "ok"); await updateQueueUI(); if (state && state.token){ await syncQueue(state); } });
  window.addEventListener("offline", async () => { setNetBadge(false); await updateQueueUI(); });

  qs("#btnLogout").addEventListener("click", () => {
    openModal("Cerrar sesión","<div class='muted'>Se eliminará el token local. Los registros locales permanecerán en este dispositivo.</div>",[
      btn("Cancelar","btn btn--light", () => closeModal()),
      btn("Salir","btn btn--danger", () => {
        state.token=null;
        state.user=null;
        saveState(state);
        closeModal();
        renderLogin(state);
        setUserUI(state);
      })
    ]);
  });

  qs("#btnSync").addEventListener("click", async () => {
    const st = loadState() || state;
    await syncQueue(st);
  });

  if (!state.token || !state.user){
    await renderLogin(state);
  } else {
    await bootstrap(state);
  }
}

main();