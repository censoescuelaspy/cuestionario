/**
 * SIDIE backend mínimo: Google Apps Script (Web App).
 * Guarda respuestas en Google Sheets y fotos en Drive.
 *
 * Requiere:
 * - Spreadsheet con hojas: usuarios, escuelas_muestra, respuestas, fotos
 * - Carpeta Drive destino (ID) para almacenar fotos.
 *
 * Seguridad:
 * - Login contra hoja 'usuarios' (user/paswor).
 * - Token simple con TTL almacenado en PropertiesService.
 * - Acceso a Web App: "Cualquiera con el enlace" (por CORS desde GitHub Pages).
 */

const SPREADSHEET_ID = "1uYXF7pxg8jz6sz2uWe75GgtX7I4hJDhqoqtXb83ob44";
const SHEET_USERS = "usuarios";
const SHEET_SCHOOLS = "escuelas_muestra";
const SHEET_ASSIGN = "escuelas_muestra"; // asignación por columna USUARIO en esta misma hoja
const SHEET_RESP = "respuestas";
const SHEET_PHOTOS = "fotos";
const DRIVE_FOLDER_ID = "1MtFgyyCaAF4MyfRmpvFAvwjgzSn75V_-";
const TOKEN_TTL_MIN = 12 * 60; // 12 horas

function jsonOut(obj){
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  // CORS
  return out;
}

function doGet(e){
  // Ping simple
  return jsonOut({ ok: true, message: "SIDIE backend online" });
}

function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents || "{}");
    const op = body.op;
    if (!op) return jsonOut({ ok:false, error:"Falta parámetro op." });

    if (op === "ping"){
      return jsonOut({ ok:true, ts: new Date().toISOString() });
    }

    if (op === "login"){
      const user = String(body.user || "").trim();
      const pass = String(body.pass || "");
      if (!user || !pass) return jsonOut({ ok:false, error:"Credenciales incompletas." });
      const u = authUser_(user, pass);
      if (!u) return jsonOut({ ok:false, error:"Usuario o contraseña inválidos." });
      const token = issueToken_(u.user);
      return jsonOut({ ok:true, token, user: u });
    }

    // operaciones protegidas
    const token = String(body.token || "");
    const session = validateToken_(token);
    if (!session) return jsonOut({ ok:false, error:"Token inválido o expirado." });

    if (op === "school_search" || op === "assigned_list"){
      // Por política operativa, el catálogo disponible para cada usuario se restringe
      // a las escuelas asignadas en la hoja SHEET_ASSIGN.
      const q = String(body.q || "").trim();
      const limit = Math.min(Math.max(Number(body.limit || 25), 1), 200);
      const results = assignedList_(session.user, q, limit);
      return jsonOut({ ok:true, results });
    }

    if (op === "school_get"){
      const codigo = String(body.codigo || "").trim();
      if (!codigo) return jsonOut({ ok:false, error:"Falta codigo." });
      const s = schoolGetForUser_(session.user, codigo);
      if (!s) return jsonOut({ ok:false, error:"Escuela no asignada al usuario o no encontrada." });
      return jsonOut({ ok:true, school: s });
    }

    if (op === "submit"){
      const payload = body;
      const school = payload.school || {};
      const codigo = String(school.CODIGO || payload.codigo || "").trim();
      if (!codigo) return jsonOut({ ok:false, error:"Falta CODIGO de escuela en el payload." });
      if (!isAssigned_(session.user, codigo)){
        return jsonOut({ ok:false, error:"Escuela no asignada al usuario. Envío rechazado." });
      }
      const rowCount = saveResponses_(session.user, payload);
      return jsonOut({ ok:true, rows: rowCount });
    }

    if (op === "upload_photo"){
      const codigo = String(body.codigo || "").trim();
      if (!codigo) return jsonOut({ ok:false, error:"Falta CODIGO en upload_photo." });
      if (!isAssigned_(session.user, codigo)){
        return jsonOut({ ok:false, error:"Escuela no asignada al usuario. Carga de foto rechazada." });
      }
      const url = uploadPhoto_(session.user, body);
      return jsonOut({ ok:true, url });
    }

    return jsonOut({ ok:false, error:"Operación no soportada: " + op });

  }catch(err){
    return jsonOut({ ok:false, error: String(err) });
  }
}

function ss_(){
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(name){
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh){
    sh = ss.insertSheet(name);
  }
  return sh;
}

function getHeaders_(sh){
  const lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  const values = sh.getRange(1,1,1,lastCol).getValues()[0];
  return values.map(v => String(v || "").trim());
}

function ensureHeaders_(sh, headers){
  const cur = getHeaders_(sh);
  if (cur.length === 0){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return;
  }
  // si difiere, no sobreescribe para evitar pérdida. Solo agrega faltantes al final.
  const missing = headers.filter(h => cur.indexOf(h) === -1);
  if (missing.length > 0){
    sh.getRange(1, cur.length+1, 1, missing.length).setValues([missing]);
  }
}

function authUser_(user, pass){
  const sh = getSheet_(SHEET_USERS);
  const rng = sh.getDataRange().getValues();
  if (rng.length < 2) return null;
  const headers = rng[0].map(h => String(h || "").trim().toLowerCase());
  const idx = {
    user: headers.indexOf("user"),
    pass: headers.indexOf("paswor"),
    email: headers.indexOf("email"),
    celular: headers.indexOf("celular")
  };
  if (idx.user < 0 || idx.pass < 0) return null;

  for (let i=1;i<rng.length;i++){
    const row = rng[i];
    const u = String(row[idx.user] || "").trim();
    const p = String(row[idx.pass] || "");
    if (u === user && p === pass){
      return {
        user: u,
        email: idx.email>=0 ? String(row[idx.email]||"").trim() : "",
        celular: idx.celular>=0 ? String(row[idx.celular]||"").trim() : ""
      };
    }
  }
  return null;
}

function issueToken_(user){
  const token = Utilities.getUuid();
  const exp = Date.now() + TOKEN_TTL_MIN * 60 * 1000;
  const props = PropertiesService.getScriptProperties();
  props.setProperty("token_" + token, JSON.stringify({ user, exp }));
  return token;
}

function validateToken_(token){
  if (!token) return null;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("token_" + token);
  if (!raw) return null;
  const obj = JSON.parse(raw);
  if (!obj.exp || Date.now() > obj.exp){
    props.deleteProperty("token_" + token);
    return null;
  }
  return { user: obj.user };
}


/**
 * Catálogo restringido por usuario: asignaciones en SHEET_ASSIGN.
 * La hoja de asignación debe contener al menos: usuario, CODIGO, NOMBRE.
 * Columnas adicionales recomendadas: DEPTO, DIST, ZONA, LOCALIDAD, ESTRATO, GRUPO_MATRICULA, MATRICULA.
 */
function assignedList_(user, q, limit){
  // Fuente: escuelas_muestra (columna USUARIO), se listan solo las escuelas asignadas al usuario logeado.
  const sh = getSheet_(SHEET_ASSIGN); // apuntando a escuelas_muestra
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h||"").trim().toUpperCase());

  const ix = (names) => {
    for (const n of names){
      const j = headers.indexOf(n);
      if (j >= 0) return j;
    }
    return -1;
  };

  const iUSR = ix(["USUARIO","USER","USERNAME","USU"]);
  const iCOD = ix(["CODIGO","CODIGO_ESCUELA","CUE"]);
  const iNOM = ix(["NOMBRE","NOMBRE_ESCUELA","ESTABLECIMIENTO"]);

  const iDEP = ix(["DEPTO","DEPARTAMENTO"]);
  const iDIS = ix(["DIST","DISTRITO"]);
  const iZON = ix(["ZONA"]);
  const iLOC = ix(["LOCALIDAD","BARRIO"]);
  const iEST = ix(["ESTRATO"]);
  const iGRU = ix(["GRUPO_MATRICULA","GRUPO"]);
  const iMAT = ix(["MATRICULA"]);
  const iLAT = ix(["LAT_DEC","LATITUD","LAT"]);
  const iLNG = ix(["LNG_DEC","LONG_DEC","LONGITUD","LON","LNG"]);
  const iAPA = ix(["ALUMNOS_POR_AULA","ALUMNOS_AULA"]);
  const iAUE = ix(["AULAS_EST","AULAS"]);

  if (iUSR < 0 || iCOD < 0 || iNOM < 0) return [];

  const u = String(user||"").trim().toLowerCase();
  const qq = String(q||"").trim().toLowerCase();
  const lim = Math.max(1, Math.min(Number(limit||50), 500));

  const normDec = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v).trim();
    if (!s) return "";
    // si viene con coma decimal, normalizar a punto
    return s.replace(",", ".");
  };

  const cellHasUser = (cell) => {
    const raw = String(cell||"").trim().toLowerCase();
    if (!raw) return false;
    // permitir múltiples usuarios por separadores comunes, también "*" como comodín
    const toks = raw.split(/[,;|]+/).map(x => x.trim()).filter(Boolean);
    return toks.indexOf(u) >= 0 || toks.indexOf("*") >= 0;
  };

  const out = [];
  for (let r = 1; r < values.length; r++){
    const row = values[r];

    if (!cellHasUser(row[iUSR])) continue;

    const cod = String(row[iCOD]||"").trim();
    const nom = String(row[iNOM]||"").trim();
    if (!cod) continue;

    if (qq){
      const hay = (cod.toLowerCase().indexOf(qq) >= 0) || (nom.toLowerCase().indexOf(qq) >= 0);
      if (!hay) continue;
    }

    out.push({
      CODIGO: cod,
      NOMBRE: nom,
      DEPTO: iDEP>=0 ? String(row[iDEP]||"").trim() : "",
      DIST: iDIS>=0 ? String(row[iDIS]||"").trim() : "",
      ZONA: iZON>=0 ? String(row[iZON]||"").trim() : "",
      LOCALIDAD: iLOC>=0 ? String(row[iLOC]||"").trim() : "",
      ESTRATO: iEST>=0 ? String(row[iEST]||"").trim() : "",
      GRUPO_MATRICULA: iGRU>=0 ? String(row[iGRU]||"").trim() : "",
      MATRICULA: iMAT>=0 ? row[iMAT] : "",
      LAT_DEC: iLAT>=0 ? normDec(row[iLAT]) : "",
      LNG_DEC: iLNG>=0 ? normDec(row[iLNG]) : "",
      ALUMNOS_POR_AULA: iAPA>=0 ? row[iAPA] : "",
      AULAS_EST: iAUE>=0 ? row[iAUE] : ""
    });

    if (out.length >= lim) break;
  }

  out.sort((a,b) => (String(a.NOMBRE).localeCompare(String(b.NOMBRE)) || String(a.CODIGO).localeCompare(String(b.CODIGO))));
  return out;
}

function isAssigned_(user, codigo){
  const cod = String(codigo||"").trim();
  if (!cod) return false;
  const res = assignedList_(user, cod, 1);
  return res.length > 0 && String(res[0].CODIGO) === cod;
}

/**
 * Devuelve ficha completa para el usuario:
 * - Base principal: escuelas_muestra (para coordenadas u otros campos).
 * - Complemento: asigna_escuelas_usuarios (para estrato u otras variables de muestreo).
 */
function schoolGetForUser_(user, codigo){
  const cod = String(codigo||"").trim();
  if (!cod) return null;

  // Validación estricta por asignación (columna USUARIO en escuelas_muestra)
  const assigned = assignedList_(user, cod, 20).filter(x => String(x.CODIGO) === cod);
  if (assigned.length === 0) return null;

  // Como la asignación y el marco están en la misma hoja, el registro ya incluye los campos relevantes
  return assigned[0];
}

// Compatibilidad: schoolSearch_ mantiene firma previa pero restringe a asignación del usuario.
// (El frontend actualizado usa assigned_list).
function schoolSearch_(user, q, limit){
  return assignedList_(user, q, limit);
}

// Mantener nombre previo: schoolGet_ (no usada directamente por el frontend nuevo).
function schoolGet_(codigo){
  // por compatibilidad no hay usuario, se recomienda no usar
  const res = schoolSearch_("",
    String(codigo||"").trim(), 1
  );
  return res.length ? res[0] : null;
}


function saveResponses_(user, payload){
  const sh = getSheet_(SHEET_RESP);
  const headers = [
    "TIMESTAMP","USER","VISIT_ID","DEVICE_ID",
    "CODIGO","NOMBRE","DEPTO","DIST","ZONA","LOCALIDAD","LAT_DEC","LNG_DEC",
    "MODULE_ID","ENTITY_TYPE","ENTITY_ID",
    "ITEM_CODE","ANSWER","ANSWER_JSON",
    "CLIENT_TS","OFFLINE"
  ];
  ensureHeaders_(sh, headers);
  const idxMap = headerIndexMap_(sh);

  const school = payload.school || {};
  const visitId = String(payload.visit_id || "");
  const deviceId = String(payload.device_id || "");
  const moduleId = String(payload.module_id || "");
  const entityType = String(payload.entity_type || "");
  const entityId = String(payload.entity_id || "");
  const clientTs = String(payload.client_ts || "");
  const offline = payload.offline ? "TRUE" : "FALSE";

  const answers = payload.answers || {};
  const now = new Date();

  const rows = [];
  Object.keys(answers).forEach(code => {
    const ans = answers[code];
    const ansStr = (ans === null || ans === undefined) ? "" : (Array.isArray(ans) ? ans.join(" | ") : String(ans));
    const ansJson = JSON.stringify(ans);

    const row = {};
    row["TIMESTAMP"] = now;
    row["USER"] = user;
    row["VISIT_ID"] = visitId;
    row["DEVICE_ID"] = deviceId;

    row["CODIGO"] = String(school.CODIGO || "");
    row["NOMBRE"] = String(school.NOMBRE || "");
    row["DEPTO"] = String(school.DEPTO || "");
    row["DIST"] = String(school.DIST || "");
    row["ZONA"] = String(school.ZONA || "");
    row["LOCALIDAD"] = String(school.LOCALIDAD || "");
    row["LAT_DEC"] = school.LAT_DEC;
    row["LNG_DEC"] = school.LNG_DEC;

    row["MODULE_ID"] = moduleId;
    row["ENTITY_TYPE"] = entityType;
    row["ENTITY_ID"] = entityId;

    row["ITEM_CODE"] = String(code);
    row["ANSWER"] = ansStr;
    row["ANSWER_JSON"] = ansJson;

    row["CLIENT_TS"] = clientTs;
    row["OFFLINE"] = offline;
    rows.push(row);
  });

  if (rows.length === 0) return 0;

  const out = rows.map(r => headers.map(h => (h in r ? r[h] : "")));
  sh.getRange(sh.getLastRow()+1, 1, out.length, headers.length).setValues(out);
  return out.length;
}

function headerIndexMap_(sh){
  const headers = getHeaders_(sh);
  const m = {};
  headers.forEach((h,i) => m[h]=i+1);
  return m;
}

function uploadPhoto_(user, body){
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

  const visitId = String(body.visit_id || "VISITA");
  const moduleId = String(body.module_id || "MOD");
  const entityType = String(body.entity_type || "");
  const entityId = String(body.entity_id || "");
  const codigo = String(body.codigo || "");
  const fileName = String(body.file_name || ("foto_" + Utilities.getUuid() + ".jpg"));
  const contentType = String(body.content_type || "image/jpeg");
  const sizeBytes = Number(body.size_bytes || 0);

  // crear subcarpeta por visita
  let sub = null;
  const it = folder.getFoldersByName(visitId);
  if (it.hasNext()){
    sub = it.next();
  } else {
    sub = folder.createFolder(visitId);
  }

  const dataUrl = String(body.data_url || "");
  const m = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!m) throw new Error("data_url inválido.");
  const b64 = m[2];
  const bytes = Utilities.base64Decode(b64);
  const blob = Utilities.newBlob(bytes, contentType, fileName);

  const file = sub.createFile(blob);
  // Link compartible
  try{
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }catch(err){}

  const url = file.getUrl();

  // registrar en hoja fotos
  const sh = getSheet_(SHEET_PHOTOS);
  const headers = ["TIMESTAMP","USER","VISIT_ID","CODIGO","MODULE_ID","ENTITY_TYPE","ENTITY_ID","FILE_NAME","CONTENT_TYPE","SIZE_BYTES","DRIVE_FILE_ID","URL"];
  ensureHeaders_(sh, headers);
  sh.appendRow([new Date(), user, visitId, codigo, moduleId, entityType, entityId, fileName, contentType, sizeBytes, file.getId(), url]);

  return url;
}
