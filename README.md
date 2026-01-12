# SIDIE Relevamiento (GitHub Pages + Google Sheets)

Repositorio base para una app web modular, con autenticación, catálogo de escuelas, captura por módulos, modo offline con cola de sincronización, y almacenamiento en Google Sheets. Incluye carga de fotos a Google Drive (carpeta destino configurable en Apps Script).

## 1) Componentes

- **Frontend (GitHub Pages)**: HTML, CSS, JavaScript (ES Modules), PWA con Service Worker y cola offline (IndexedDB).
- **Backend (Google Apps Script)**: Web App (doPost) con operaciones:
  - login (valida contra hoja `usuarios`)
  - school_search, school_get (lee hoja `escuelas_muestra`)
  - submit (guarda respuestas en hoja `respuestas`)
  - upload_photo (guarda imagen en Drive y registra en hoja `fotos`)

## 2) Requisitos en Google Sheets

Libro: `1uYXF7pxg8jz6sz2uWe75GgtX7I4hJDhqoqtXb83ob44`

Hojas esperadas (ajuste nombres si difieren):
- `usuarios`: columnas `user | paswor | email | celular`
- `escuelas_muestra`: columnas del marco muestral, incluyendo al menos `CODIGO | NOMBRE | DEPTO | DIST | ZONA | LOCALIDAD | LAT_DEC | LNG_DEC`
- `respuestas`: se crea o completa con encabezados estándar
- `fotos`: se crea si no existe

## 3) Configurar y desplegar Google Apps Script

1. Crear un proyecto Apps Script.
2. Copiar el contenido de `apps_script/Code.gs` como archivo principal.
3. Verificar constantes `SPREADSHEET_ID` y `DRIVE_FOLDER_ID`.
4. Implementar como **Web App**:
   - Ejecutar como: usted (o cuenta institucional)
   - Quién tiene acceso: cualquiera con el enlace (para permitir llamadas desde GitHub Pages)
5. Copiar la URL de la Web App y pegarla en `assets/js/config.js` (APPS_SCRIPT_URL).

## 4) Publicar en GitHub Pages

1. Subir este repositorio a GitHub.
2. Settings → Pages → Deploy from branch → seleccionar `main` (root).
3. Abrir la URL de Pages, iniciar sesión y seleccionar escuela.

## 5) Esquemas de módulos

Los esquemas están en `schemas/*.json` y se generaron a partir del cuestionario Excel (secciones: General, Servicios, Exteriores, Bloques, Áreas, Aulas, Dependencias, Laboratorio, Taller, Sanitario). Incluyen reglas `show_if` derivadas de notas de salto detectadas en el Excel, en la medida en que el formato permitió inferencia automática.

Si requiere ampliar o corregir saltos específicos, edite el JSON del módulo, por ejemplo:

```json
"show_if": [{"q":"3.1","op":"in","values":["Losa H°A°"]}]
```

## 6) Modo offline (cola de sincronización)

- Si no hay conexión o falla el envío, el registro queda en cola.
- El contador “Pendientes” indica la cantidad de envíos no sincronizados.
- Use “Sincronizar” cuando haya conectividad.

## 7) Fotos

- Se adjuntan por módulo y se envían a Drive con metadatos (visita, módulo, unidad).
- La carpeta destino se define en Apps Script.

