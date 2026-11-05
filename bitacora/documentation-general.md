# Cómo funciona cada archivo

## Idea general

Tienes tres piezas con roles distintos:

| Archivo | Rol | Hace red | Se publica |
|---|---|---|---|
| `scripts/save.ts` | Herramienta tuya para descargar una página y guardarla | Sí | No |
| `src/index.ts` | La librería real | `getVideoInfo` y `getResolutions` | Sí |
| `scripts/test.ts` | Prueba rápida de `parseVideo` y de las resoluciones | Solo `getResolutions` | No |

La separación importante es esta: **`parseVideo`, `parsePlayerUrls` y `parseHlsMaster` solo procesan texto; `getVideoInfo` y `getResolutions` son las que descargan**. Así puedes probar el parseo sin internet, con un HTML guardado.

---

## 1. `scripts/save.ts`

```ts
import { writeFileSync } from "node:fs";
```
- `node:fs` es el módulo de archivos que ya viene con Node. El prefijo `node:` indica que es interno y no un paquete de npm.
- `writeFileSync` escribe un archivo. El sufijo `Sync` significa que el programa espera a que termine antes de seguir. Para un script simple está bien.

```ts
const url = process.argv[2];
```
- `process.argv` es la lista de argumentos con los que se ejecutó el programa. Con `node scripts/save.ts "https://x.com/video"` vale:
  - `argv[0]` → ruta de `node.exe`
  - `argv[1]` → ruta de `save.ts`
  - `argv[2]` → `"https://x.com/video"`, lo primero que tú escribiste
- Si no pasas link, `url` es `undefined` y `fetch` falla.

```ts
const res = await fetch(url, {
  redirect: "follow",
  headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
});
```
- `fetch` hace una petición HTTP GET, igual que tu navegador al abrir una página.
- `await` espera la respuesta. Usarlo fuera de una función (*top-level await*) solo es posible porque tu `package.json` tiene `"type": "module"`.
- `redirect: "follow"` es la solución al error 301 del principio. Cuando el servidor responde "esto se movió a otra URL", `fetch` va solo a la nueva dirección. La librería vieja no hacía eso.
- `user-agent` es una cabecera que dice qué programa hace la petición. Sin ella, Node se identifica como `node` y muchos sitios lo bloquean. Con ella te haces pasar por un navegador.

```ts
console.log("status:", res.status, "url final:", res.url);
```
- `res.status` es el código HTTP (200 = ok, 403 = bloqueado, 404 = no existe).
- `res.url` es la URL **después** de las redirecciones. Si difiere de la que pusiste, hubo redirección.

```ts
writeFileSync("sample.html", await res.text());
```
- `res.text()` lee el cuerpo de la respuesta como texto. Es asíncrono, por eso lleva `await`.
- Se guarda en `sample.html`. La ruta es relativa a **la carpeta desde donde ejecutaste el comando**, no a la carpeta del script. Por eso aparece en la raíz del proyecto.

**Ojo:** `fetch` no lanza error con un 403 o 404, solo con fallos de red. Este script guardaría igualmente la página de error. Por eso conviene mirar el `status` impreso.

---

## 2. `src/index.ts`

### Importación

```ts
import * as cheerio from "cheerio";
```
Cheerio es un lector de HTML para Node con sintaxis tipo jQuery. Convierte el texto HTML en una estructura donde puedes buscar con selectores CSS. `* as cheerio` importa todo lo que exporta el paquete bajo el nombre `cheerio`.

### La interfaz

```ts
export interface VideoInfo {
  title: string | null;
  ...
}
```
- Describe la forma del objeto que devuelve tu librería.
- `string | null` significa "texto o nulo". Es nulo cuando el dato no se encontró.
- Las interfaces **no existen en JavaScript**: solo sirven para que el editor te avise de errores. Al ejecutar desaparecen.

### `parseVideo`

```ts
const $ = cheerio.load(html);
```
`load` analiza el texto HTML y devuelve una función, que por costumbre se llama `$`. Con ella buscas elementos: `$("title")`, `$("meta")`, etc.

```ts
const meta = (p: string) => $(`meta[property="${p}"]`).attr("content") ?? null;
```
Es una función pequeña para no repetir código. Paso a paso, con `meta("og:title")`:
1. Se arma el selector `meta[property="og:title"]`, que busca `<meta property="og:title" content="...">`.
2. `.attr("content")` toma el valor del atributo `content`, o `undefined` si no existe.
3. `?? null` cambia `undefined` por `null`. El operador `??` solo reacciona a `null`/`undefined`, a diferencia de `||`, que también reaccionaría a un texto vacío.

Las etiquetas `og:` (Open Graph) existen para que WhatsApp o Facebook muestren una vista previa al compartir un enlace. Por eso casi todos los sitios las traen bien llenas.

```ts
let jsonLd: unknown = null;
try {
  const raw = $('script[type="application/ld+json"]').first().html();
  if (raw) jsonLd = JSON.parse(raw);
} catch {}
```
- Busca el primer `<script type="application/ld+json">`, un bloque de datos estructurados pensado para buscadores.
- `.html()` devuelve el contenido interno como texto.
- `JSON.parse` lo convierte en objeto.
- El `try/catch` existe porque si el JSON viene mal escrito, `JSON.parse` lanza un error. El `catch {}` vacío lo ignora y deja `jsonLd` en `null`.
- `unknown` significa "no sé la forma de este dato". TypeScript te obliga a revisarlo antes de usarlo.

```ts
return {
  title: meta("og:title") ?? $("title").text() ?? null,
  ...
};
```
Para el título prueba primero `og:title` y, si no existe, usa la etiqueta `<title>`. Un detalle: `$("title").text()` devuelve `""` y no `undefined` cuando no hay etiqueta, así que el último `?? null` nunca se activa. No es grave, pero es más correcto `$("title").text() || null`.

### `getVideoInfo`

```ts
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const res = await fetch(url, { ... });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return parseVideo(await res.text());
}
```
- `async` hace que la función devuelva una `Promise`, que es un resultado que llegará más tarde.
- `res.ok` es `true` si el código está entre 200 y 299. Si no, se lanza un error con un mensaje claro. Esto compensa que `fetch` no falla solo con 403 o 404.
- Finalmente une las dos piezas: descarga el texto y se lo pasa a `parseVideo`.

### `export`

Solo lo marcado con `export` es visible desde fuera. Si hicieras otra función sin `export`, quedaría privada del archivo.

### Resoluciones (agregado el 2026-11-05)

Los datos de calidades **no** están en las etiquetas `og:` ni en el JSON-LD (ahí solo viene un `contentUrl` de una calidad, 360p). Están en el `<script>` del reproductor, en llamadas parecidas a estas:

```js
html5player.setVideoUrlLow('https://...mp4?...');
html5player.setVideoUrlHigh('https://...mp4?...');
html5player.setVideoHLS('https://...hls.m3u8?...');
```

- `Low` y `High` son solo 2 calidades MP4.
- `setVideoHLS` apunta a una **lista maestra** (`.m3u8`) que enumera todas las calidades (360p, 480p, 720p, 1080p...).

> Los nombres exactos (`setVideoUrlLow`, etc.) hay que confirmarlos buscando `setVideo` en `sample.html` con `Ctrl+F`. Si cambian, hay que ajustar `parsePlayerUrls`.

El proceso tiene 3 funciones encadenadas:

```
sample.html ──► parsePlayerUrls ──► { low, high, hls }
                                          │
                                          └─ hls ──► fetch ──► texto .m3u8 ──► parseHlsMaster ──► { "hls-720p": url, ... }
                                                                                       │
                          getResolutions junta low + high + lo de HLS ◄────────────────┘
```

#### El tipo

```ts
export type Resolutions = Record<string, string>;
```
- `Record<string, string>` es un objeto cuyas claves son texto y cuyos valores también. Ejemplo: `{ "hls-720p": "https://..." }`.
- Es un `type` y no una `interface` porque solo es un alias de una forma ya existente. Igual que las interfaces, **desaparece al ejecutar**.

#### `parsePlayerUrls` (solo procesa texto, sin red)

```ts
export function parsePlayerUrls(html: string) {
  const grab = (name: string) =>
    html.match(new RegExp(`setVideo${name}\\(\\s*['"]([^'"]+)['"]\\s*\\)`))?.[1] ?? null;
```
- `grab` es una función pequeña para no repetir la búsqueda tres veces.
- Con `grab("UrlLow")` se arma esta expresión regular: `setVideoUrlLow\(\s*['"]([^'"]+)['"]\s*\)`. Pieza por pieza:
  - `setVideoUrlLow` → el texto literal.
  - `\(` → un paréntesis de apertura literal. Se escribe `\\(` dentro del string de JavaScript porque la barra invertida hay que duplicarla.
  - `\s*` → cero o más espacios, por si el código tiene `setVideoUrlLow( 'url' )`.
  - `['"]` → una comilla simple o doble.
  - `([^'"]+)` → **el grupo de captura**: uno o más caracteres que no sean comilla. Es la URL.
  - `['"]` → la comilla de cierre.
  - `\s*\)` → espacios opcionales y el paréntesis de cierre.
- `html.match(...)` devuelve un arreglo: la posición `[0]` es todo lo encontrado y `[1]` es el contenido del grupo de captura (la URL). Si no hay coincidencia devuelve `null`.
- `?.[1]` es *optional chaining*: si `match` devolvió `null`, no explota, devuelve `undefined`. Luego `?? null` lo convierte en `null`.

```ts
  return {
    low: grab("UrlLow"),
    high: grab("UrlHigh"),
    hls: grab("HLS"),
  };
}
```
Devuelve las tres URLs. Cada una es `string` si se encontró o `null` si no. **Si todo sale `null`, los nombres en el script de la página son distintos** y hay que ajustar la expresión.

Por qué una expresión regular y no cheerio: la URL no está en una etiqueta HTML, está **dentro de código JavaScript** en un `<script>`. Cheerio entiende HTML, no el contenido de ese código.

#### `parseHlsMaster` (solo procesa texto, sin red)

Una lista maestra `.m3u8` se ve así:

```
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
hls-360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
hls-720p.m3u8
```

Cada calidad ocupa **dos líneas**: una que empieza con `#EXT-X-STREAM-INF` (los metadatos) y la siguiente con la URL de esa calidad.

```ts
export function parseHlsMaster(m3u8: string, masterUrl: string): Resolutions {
  const out: Resolutions = {};
  const lines = m3u8.split(/\r?\n/);
```
- `out` es el objeto donde se acumula el resultado.
- `split(/\r?\n/)` separa el texto en líneas. Acepta saltos de línea de Windows (`\r\n`) y de Linux (`\n`).

```ts
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
```
- Se recorre línea por línea con un índice `i` (hace falta el índice para poder mirar la línea siguiente).
- Si la línea no es de metadatos, `continue` salta a la siguiente vuelta.

```ts
    const height = line.match(/RESOLUTION=\d+x(\d+)/)?.[1];
    const next = lines[i + 1]?.trim();
    if (!height || !next) continue;
```
- `RESOLUTION=\d+x(\d+)` busca `RESOLUTION=1280x720` y captura solo la altura (`720`), que es lo que llamamos "calidad".
- `next` es la línea siguiente (la URL). `trim()` quita espacios y saltos sobrantes. El `?.` evita un error si `i + 1` no existe.
- Si falta alguno de los dos datos, se salta esa entrada.

```ts
    out[`hls-${height}p`] = new URL(next, masterUrl).href;
  }
  return out;
}
```
- La clave se arma como `hls-720p`. Si prefieres otro nombre (por ejemplo `hd-720p`), se cambia aquí.
- `new URL(next, masterUrl)` resuelve URLs **relativas**. Si `next` es `hls-720p.m3u8` y la maestra es `https://cdn.com/a/b/hls.m3u8`, el resultado es `https://cdn.com/a/b/hls-720p.m3u8`. Si `next` ya era absoluta, la respeta tal cual.
- `.href` devuelve la URL completa como texto.

#### `getResolutions` (hace red)

```ts
export async function getResolutions(html: string): Promise<Resolutions> {
  const { low, high, hls } = parsePlayerUrls(html);
  const resolutions: Resolutions = {};
```
- Recibe el **HTML ya descargado**, no una URL. Así no vuelve a pedir la página y se puede probar con `sample.html`.
- `{ low, high, hls }` es *desestructuración*: saca las tres propiedades del objeto en variables sueltas.

```ts
  if (low) resolutions["mp4-low"] = low;
  if (high) resolutions["mp4-high"] = high;
```
Solo agrega las calidades que se encontraron (las `null` se ignoran).

```ts
  if (hls) {
    const res = await fetch(hls, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (res.ok) {
      Object.assign(resolutions, parseHlsMaster(await res.text(), hls));
    }
  }
  return resolutions;
}
```
- Si hay URL HLS, descarga la lista maestra. Mismo `user-agent` que antes.
- Aquí **no se lanza error** si falla (`res.ok` falso): simplemente se devuelven las calidades MP4 que ya se tenían. Es una decisión consciente; si prefieres que falle con ruido, cambia por `throw new Error(...)`.
- `Object.assign(a, b)` copia todas las propiedades de `b` dentro de `a`.
- Se pasa `hls` como segundo argumento a `parseHlsMaster` para resolver URLs relativas.

#### Advertencias importantes

- **Las URLs llevan un token** (`secure=...`) y **caducan**. No las guardes para usarlas días después: vuelve a pedir la página.
- **HLS no es un solo archivo.** Cada `hls-1080p` es otra lista `.m3u8` con cientos de fragmentos `.ts`. Para obtener un video completo hay que descargar y unir los fragmentos, normalmente con `ffmpeg`:
  ```powershell
  ffmpeg -i "URL_DEL_M3U8" -c copy video.mp4
  ```
- **Si el servidor responde 403** al pedir la lista HLS, prueba a añadir la cabecera `referer` con la URL de la página.
- Respeta los términos de uso del sitio y no hagas muchas peticiones seguidas.

---

## 3. `scripts/test.ts`

```ts
import { readFileSync } from "node:fs";
import { parseVideo } from "../src/index.ts";
```
- `readFileSync` es el opuesto de `writeFileSync`.
- `"../src/index.ts"` es una ruta relativa **a este archivo**: `..` sube de `scripts/` a la raíz y luego entra en `src/`.
- Lleva `.ts` al final porque Node ejecuta TypeScript directamente y no adivina extensiones.

```ts
const html = readFileSync("sample.html", "utf8");
```
Sin `"utf8"` devolvería un `Buffer` (bytes crudos). Con él devuelve texto. Esta ruta sí es relativa a donde ejecutas el comando (la raíz del proyecto).

```ts
console.log(parseVideo(html));
```
Llama a tu función con el HTML guardado e imprime el objeto resultante. **No hay internet de por medio**, así que puedes repetirlo mil veces mientras ajustas selectores.

### Versión con resoluciones (agregado el 2026-11-05)

```ts
import { readFileSync } from "node:fs";
import { parsePlayerUrls, getResolutions } from "../src/index.ts";

const html = readFileSync("sample.html", "utf8");

console.log(parsePlayerUrls(html));       // 1) ¿encuentra las URLs en el script?
console.log(await getResolutions(html));  // 2) resultado final con todas las calidades
```
- Se comprueba primero `parsePlayerUrls`: si sale todo `null`, el problema está en la expresión regular y no tiene sentido seguir.
- `getResolutions` **sí usa internet** (descarga la lista HLS), así que esta parte ya no es 100 % offline.
- Resultado esperado:

```
{
  "mp4-low": "https://...",
  "mp4-high": "https://...",
  "hls-360p": "https://...",
  "hls-480p": "https://...",
  "hls-720p": "https://...",
  "hls-1080p": "https://..."
}
```

---

## 4. Qué pasa al ejecutar `node scripts/save.ts "link"`

1. **PowerShell** separa el comando en palabras. Las comillas sirven para que caracteres como `&` o `?` del link no se interpreten como parte del shell.
2. **Node arranca** y lee tu `package.json`. Al ver `"type": "module"`, trata el archivo como ESM, y por eso funcionan `import` y `await` en el nivel superior.
3. **Node borra los tipos** (`: string`, `interface`...) y ejecuta el JavaScript resultante. Importante: **no comprueba errores de tipos**. Para eso está `tsc`.
4. **Se llena `process.argv`** y `url` toma tu link.
5. **`fetch` trabaja:** resuelve el dominio (DNS), abre una conexión segura (TLS), envía el GET con tus cabeceras y recibe la respuesta. Si llega un 301, repite el proceso con la nueva URL.
6. **Se imprime el estado**, se lee el cuerpo y se escribe `sample.html`.
7. **El proceso termina** porque ya no queda nada pendiente.

```
tu link ──► fetch ──► servidor ──► (301?) ──► nueva URL ──► 200 + HTML
                                                              │
                                              sample.html ◄───┘
                                                   │
                       test.ts ──► parseVideo ◄────┘ ──► objeto con datos
```

---

## 5. Qué pasa cuando otros usan tu librería como módulo

Hasta ahora `test.ts` importa directamente `src/index.ts`. Un usuario real **no** usa `src`. Usa lo que generó el build:

```
src/index.ts ──(pnpm build)──► dist/index.js    (ESM)
                               dist/index.cjs   (CommonJS)
                               dist/index.d.ts  (tipos)
```

Cuando alguien instala tu paquete y escribe:

```ts
import { getVideoInfo } from "xvideo-download";   // ESM
// o
const { getVideoInfo } = require("xvideo-download"); // CJS
```

Node mira el campo `exports` (o `main`/`module`) de tu `package.json` y decide qué archivo de `dist` cargar. TypeScript usa `index.d.ts` para dar autocompletado.

Puntos que conviene tener claros:

- **`cheerio` debe estar en `dependencies`**, no en `devDependencies`. Cuando alguien instala tu librería, npm instala tus `dependencies` automáticamente, y tu código las necesita al ejecutarse. Al hacer `pnpm add cheerio` quedó en `dependencies`, así que está bien.
- **`"files": ["dist"]`** hace que solo `dist` viaje en el paquete. `scripts/`, `sample.html` y `src/` no se publican.
- **Si cambias `src/index.ts`**, `test.ts` ve el cambio al instante, pero un proyecto que instaló tu `.tgz` no lo verá hasta que hagas `pnpm build`, `pnpm pack` y reinstales.
- **`test.ts` y `save.ts` no son parte de la librería.** Son herramientas de desarrollo, como un banco de pruebas.

---

## Resumen mental

1. `save.ts`: descarga el HTML una vez y lo congela en `sample.html`.
2. `parseVideo`: lee ese HTML con selectores CSS y devuelve datos ordenados.
3. `test.ts`: comprueba el resultado sin tocar la red.
4. `getVideoInfo`: junta descarga y parseo para el usuario final.
5. `parsePlayerUrls` + `parseHlsMaster` + `getResolutions`: sacan todas las calidades leyendo el script del reproductor y la lista HLS.
6. `pnpm build`: convierte todo en archivos que cualquier proyecto puede importar.

Si quieres seguir, el siguiente paso natural es abrir `sample.html`, buscar qué datos extra tiene (duración, vistas, etiquetas) y agregarlos a `VideoInfo` uno por uno. Si me pegas el resultado de `node scripts/test.ts`, te ayudo a ver qué campos salieron vacíos y por qué.