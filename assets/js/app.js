import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { enqueue, getAll, remove, count as qCount } from "./offline_queue.js";
import { qs, el, btn, openModal, closeModal, setNetBadge, debounce, safeText } from "./ui.js";
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

function toast(msg){
  // Modal simple para no saturar UI
  openModal("Aviso", `<div class="muted">${safeText(msg)}</div>`, [
    btn("Cerrar","btn btn--light", () => closeModal())
  ]);
}

function normalizeLatLng(val){
  if (val==null) return null;
  if (typeof val === "number") return val;
  const s = String(val).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function renderLogin(state){
  const root = qs("#appRoot");
  root.innerHTML = "";
  const card = el("div","card","");
  card.appendChild(el("div","h1", "Acceso al sistema"));

  const grid = el("div","grid grid--2","");
  const u = el("div","");
  u.appendChild(el("div","label","Usuario"));
  const inpU = document.createElement("input");
  inpU.className="input";
  inpU.autocomplete="username";
  u.appendChild(inpU);

  const p = el("div","");
  p.appendChild(el("div","label","Contraseña"));
  const inpP = document.createElement("input");
  inpP.className="input";
  inpP.type="password";
  inpP.autocomplete="current-password";
  p.appendChild(inpP);

  grid.appendChild(u);
  grid.appendChild(p);
  card.appendChild(grid);

  card.appendChild(el("div","muted","Requiere conectividad para validar credenciales. Si ya existe una sesión previa, se intentará reutilizar el token almacenado."));

  const actions = el("div","btnrow","");
  const b = btn("Ingresar","btn", async () => {
    try{
      const user = inpU.value.trim();
      const pass = inpP.value;
      if (!user || !pass) throw new Error("Complete usuario y contraseña.");
      const data = await api.login(user, pass);
      state.token = data.token;
      state.user = data.user;
      // inicializar contexto de visita si no existe
      if (!state.visit_id) state.visit_id = uuid();
      saveState(state);
      await bootstrap(state);
    }catch(e){
      toast(e.message || String(e));
    }
  });
  actions.appendChild(b);

  if (state.token && state.user){
    const reuse = btn("Continuar con sesión previa","btn btn--light", async () => {
      await bootstrap(state);
    });
    actions.appendChild(reuse);
  }

  card.appendChild(actions);
  root.appendChild(card);
}

async function renderSchoolSelector(state){
  const card = el("div","card","");
  card.appendChild(el("div","h1","Contexto de visita, selección de escuela asignada"));

  const kp = el("div","kpi","");
  kp.appendChild(el("div","kpi__pill", "Dispositivo: " + safeText(state.device_id)));
  kp.appendChild(el("div","kpi__pill", "Visita: " + safeText(state.visit_id || "")));
  if (state.user && state.user.user){
    kp.appendChild(el("div","kpi__pill", "Usuario: " + safeText(state.user.user)));
  }
  card.appendChild(kp);

  const info = el("div","muted",
    "La lista de escuelas se limita a las asignaciones del usuario. " +
    "Si no aparece su escuela, contacte a la coordinación para actualizar la hoja asigna_escuelas_usuarios."
  );
  card.appendChild(info);

  const grid = el("div","grid grid--2","");
  const left = el("div","");
  left.appendChild(el("div","label","Escuela asignada (búsqueda por CUE o nombre)"));

  const inp = document.createElement("input");
  inp.className="input";
  inp.placeholder="Escriba para filtrar, luego seleccione una opción";
  inp.setAttribute("list","dl_assigned");
  left.appendChild(inp);

  const dl = document.createElement("datalist");
  dl.id="dl_assigned";
  left.appendChild(dl);

  const hint = el("div","muted","Sugerencia: utilice el CUE (código) para minimizar ambigüedad.");
  left.appendChild(hint);

  const right = el("div","");
  right.appendChild(el("div","label","Escuela seleccionada"));
  const sel = el("div","pill", state.school ? safeText(state.school.CODIGO + " - " + state.school.NOMBRE) : "Ninguna");
  right.appendChild(sel);

  const meta = el("div","muted","");
  if (state.school){
    meta.innerHTML = `
      <div><span class="tag">DEPTO</span> ${safeText(state.school.DEPTO || "-")}</div>
      <div><span class="tag">DIST</span> ${safeText(state.school.DIST || "-")}</div>
      <div><span class="tag">ZONA</span> ${safeText(state.school.ZONA || "-")}</div>
      <div><span class="tag">LOCALIDAD</span> ${safeText(state.school.LOCALIDAD || "-")}</div>
      <div class="muted2">Solo se permite registrar y enviar información para la escuela seleccionada.</div>
    `;
  } else {
    meta.textContent = "Seleccione una escuela para habilitar el registro de módulos.";
  }
  right.appendChild(meta);

  grid.appendChild(left);
  grid.appendChild(right);
  card.appendChild(grid);

  const actions = el("div","btnrow","");

  const bSelect = btn("Seleccionar escuela","btn", async () => {
    const raw = String(inp.value || "").trim();
    if (!raw){ toast("Seleccione una escuela asignada."); return; }
    const codigo = raw.split(" - ")[0].trim();
    if (!codigo){ toast("Seleccione una escuela válida."); return; }

    try{
      // school_get valida asignación en backend
      const data = await api.schoolGet(state.token, codigo);
      if (!data.school) throw new Error("Escuela no encontrada.");
      state.school = data.school;

      // regenerar visita para evitar mezcla de escuelas
      state.visit_id = uuid();
      saveState(state);

      sel.textContent = safeText(state.school.CODIGO + " - " + state.school.NOMBRE);
      meta.innerHTML = `
        <div><span class="tag">DEPTO</span> ${safeText(state.school.DEPTO || "-")}</div>
        <div><span class="tag">DIST</span> ${safeText(state.school.DIST || "-")}</div>
        <div><span class="tag">ZONA</span> ${safeText(state.school.ZONA || "-")}</div>
        <div><span class="tag">LOCALIDAD</span> ${safeText(state.school.LOCALIDAD || "-")}</div>
        <div class="muted2">Se creó un nuevo ID de visita para trazabilidad.</div>
      `;
      toast("Escuela seleccionada, se creó un nuevo ID de visita.");
    }catch(e){
      toast(e.message || String(e));
    }
  });
  actions.appendChild(bSelect);

  const bClear = btn("Cambiar escuela","btn btn--light", () => {
    state.school = null;
    state.visit_id = uuid();
    saveState(state);
    sel.textContent = "Ninguna";
    meta.textContent = "Seleccione una escuela para habilitar el registro de módulos.";
    inp.value = "";
    toast("Contexto reiniciado. Seleccione una escuela asignada.");
  });
  actions.appendChild(bClear);

  // cargar datalist desde asignaciones
  const fillDatalist = () => {
    dl.innerHTML = "";
    const arr = Array.isArray(state.assigned) ? state.assigned : [];
    arr.slice(0, 200).forEach(s => {
      const opt = document.createElement("option");
      opt.value = `${s.CODIGO} - ${s.NOMBRE}`;
      dl.appendChild(opt);
    });
    if (arr.length === 0){
      const opt = document.createElement("option");
      opt.value = "Sin asignaciones en caché (requiere conexión para cargar)";
      dl.appendChild(opt);
    }
  };
  fillDatalist();

  // filtro dinámico (cliente) si la lista es grande
  inp.addEventListener("input", debounce(() => {
    const q = String(inp.value||"").trim().toLowerCase();
    const arr = Array.isArray(state.assigned) ? state.assigned : [];
    dl.innerHTML = "";
    const filtered = q ? arr.filter(s => (s.CODIGO||"").toLowerCase().includes(q) || (s.NOMBRE||"").toLowerCase().includes(q)).slice(0, 200) : arr.slice(0, 200);
    filtered.forEach(s => {
      const opt = document.createElement("option");
      opt.value = `${s.CODIGO} - ${s.NOMBRE}`;
      dl.appendChild(opt);
    });
  }, 120));

  card.appendChild(actions);
  return card;
}

async function renderModuleList(state, onOpen){
  const card = el("div","card","");
  card.appendChild(el("div","h1","Módulos del relevamiento"));
  card.appendChild(el("div","muted","Complete y guarde cada módulo. Para módulos repetibles (bloques, aulas, etc.), registre un identificador por unidad."));

  const list = el("div","grid","");
  MODULES.forEach(m => {
    const row = el("div","item","");
    const savedCount = state.records[m.id] ? Object.keys(state.records[m.id]).length : 0;
    row.innerHTML = `
      <div class="item__top">
        <div>
          <div class="h2">${safeText(m.label)}</div>
          <div class="muted">Registros en este dispositivo: ${savedCount}</div>
        </div>
        <div class="btnrow">
          <button class="btn btn--light">Abrir</button>
        </div>
      </div>
    `;
    row.querySelector("button").addEventListener("click", () => onOpen(m.id));
    list.appendChild(row);
  });
  card.appendChild(list);
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

  const actions = el("div","btnrow","");
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
  const root = qs("#appRoot");
  root.innerHTML = "";
  const schema = await loadSchema(moduleId);

  const back = btn("Volver","btn btn--light", () => bootstrap(state));
  root.appendChild(el("div","card",""));
  root.firstChild.appendChild(el("div","h1", safeText(schema.title || moduleId)));
  root.firstChild.appendChild(el("div","muted","Código de visita: " + safeText(state.visit_id || "") + ", Escuela: " + safeText(state.school ? state.school.NOMBRE : "(sin seleccionar)")));
  root.firstChild.appendChild(el("div","btnrow",""));
  root.firstChild.querySelector(".btnrow").appendChild(back);

  if (!state.school){
    const warn = el("div","card","");
    warn.appendChild(el("div","h1","Seleccione una escuela"));
    warn.appendChild(el("div","muted","Antes de capturar módulos, seleccione una escuela del catálogo."));
    warn.appendChild(btn("Ir a selección","btn", () => bootstrap(state)));
    root.appendChild(warn);
    return;
  }

  const entityPicker = pickEntityUI(schema, state, moduleId, async (entityId) => {
    await moduleForm(state, schema, moduleId, entityId);
  });
  if (schema.entity_type !== "LOCAL"){
    root.appendChild(entityPicker.node);
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

  const actions = el("div","btnrow","");
  const bSave = btn("Guardar módulo","btn", async () => {
    // guardar respuestas visibles
    const answers = formState.answers || {};
    // filtrar solo ítems visibles
    const visible = {};
    schema.items.forEach(it => {
      if (it.type!=="question") return;
      // visibilidad se evalúa en cliente
      const node = form.querySelector(`[data-item-code="${it.code}"]`);
      const isHidden = node && node.classList.contains("hidden");
      if (isHidden) return;
      if (answers[it.code] !== undefined) visible[it.code] = answers[it.code];
    });

    rec.answers = answers;
    saveState(state);

    const payload = {
      visit_id: state.visit_id,
      user: state.user.user,
      device_id: state.device_id,
      school: state.school,
      module_id: moduleId,
      entity_type: schema.entity_type,
      entity_id: entityId,
      answers: visible,
      client_ts: new Date().toISOString(),
      offline: !navigator.onLine
    };

    if (!navigator.onLine){
      await enqueue({ type: "submit", payload });
      await updateQueueUI();
      toast("Guardado en cola (offline).");
      return;
    }
    try{
      await api.submit(state.token, payload);
      toast("Envío exitoso.");
    }catch(e){
      await enqueue({ type: "submit", payload });
      await updateQueueUI();
      toast("No se pudo enviar, quedó en cola.");
    }
  });

  actions.appendChild(bSave);
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

async function bootstrap(state){
  setUserUI(state);
  const root = qs("#appRoot");
  root.innerHTML = "";

  await ensureAssigned(state);

  const selector = await renderSchoolSelector(state);
  root.appendChild(selector);

  const moduleList = await renderModuleList(state, (moduleId) => moduleScreen(state, moduleId));
  root.appendChild(moduleList);

  await updateQueueUI();
}

async function main(){
  // Service worker
  if ("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){}
  }

  let state = loadState() || defaultState();
  if (!state.device_id) state.device_id = uuid();
  if (!state.visit_id) state.visit_id = uuid();
  saveState(state);

  setNetBadge(navigator.onLine);
  window.addEventListener("online", async () => { setNetBadge(true); await updateQueueUI(); if (state && state.token){ await syncQueue(state); } });
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
