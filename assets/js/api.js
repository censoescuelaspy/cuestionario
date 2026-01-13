import { CONFIG } from "./config.js";

// Nota técnica (CORS):
// Para minimizar preflight (OPTIONS) en Apps Script, se envía como text/plain con JSON en body.
async function post(op, payload){
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes("REEMPLAZAR")){
    throw new Error("CONFIG.APPS_SCRIPT_URL no está configurada.");
  }
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ op, ...payload })
  });
  const txt = await res.text();
  let data=null;
  try{ data = JSON.parse(txt); } catch(e){ data = { ok:false, error:"Respuesta no JSON", raw: txt }; }
  if (!res.ok || !data.ok){
    const msg = data && data.error ? data.error : ("Error HTTP " + res.status);
    throw new Error(msg);
  }
  return data;
}

export const api = {
  async ping(){ return post("ping", {}); },
  async login(user, pass){ return post("login", { user, pass }); },
  async assignedList(token, q, limit){
    return post("assigned_list", { token, q, limit: limit || CONFIG.MAX_SCHOOL_SUGGESTIONS });
  },
  async schoolSearch(token, q, limit){
    // Compatibilidad: en backend se restringe a asignación del usuario
    return post("school_search", { token, q, limit: limit || CONFIG.MAX_SCHOOL_SUGGESTIONS });
  },
  async schoolGet(token, codigo){
    return post("school_get", { token, codigo });
  },
  async submit(token, payload){
    return post("submit", { token, ...payload });
  },
  async uploadPhoto(token, payload){
    return post("upload_photo", { token, ...payload });
  }
};
