# Puesta en marcha, paso a paso

Tres piezas:

1. **GitHub** guarda el código y, cada madrugada, ejecuta el análisis.
2. **GitHub Actions** entra en Biwenger, calcula y deja un `market-<nombre>.json`.
3. **Vercel** publica la web, que lee esos JSON del mismo dominio.

Una vez montado no hay que tocar nada: el análisis se actualiza solo cada noche
y Vercel republica la web con los datos nuevos.

---

**Requisito:** Node 22.5 o superior. El proyecto usa el SQLite incluido en Node
y no depende de librerías nativas, así que no hace falta Python ni las
herramientas de compilación de Visual Studio.

## Parte 1 · Subir el código a GitHub

1. Descomprime el zip. Verás una carpeta `biwenger-moneyball` con `src`,
   `web`, `.github`, `package.json` y demás.
2. Entra en github.com → **New repository**. Ponle el nombre que quieras y
   créalo **público** (hace falta para que Vercel lo lea en el plan gratuito).
   No marques "Add a README".
3. En el repo vacío verás un enlace azul que dice **uploading an existing file**.
   Pínchalo.
4. **Arrastra el CONTENIDO de la carpeta**, no la carpeta en sí. Es decir,
   selecciona `src`, `web`, `.github`, `package.json`, `tsconfig.json`,
   `vercel.json`, `README.md`, `.env.example`, `.gitignore` y
   `scripts-build-web.mjs`, y suéltalos todos a la vez.
5. Abajo, botón verde **Commit changes**.

Comprueba que en la raíz del repo ves la carpeta `.github`. Si no aparece, el
navegador se la ha saltado por empezar con punto: créala a mano con
**Add file → Create new file** escribiendo la ruta completa
`.github/workflows/snapshot.yml` y pegando el contenido del fichero.

---

## Parte 2 · Las credenciales de Biwenger

Las contraseñas **nunca** van en el código ni en la web. Van en los secretos de
GitHub, que están cifrados y no se ven ni aunque el repo sea público.

En tu repo: **Settings** → menú izquierdo **Secrets and variables** →
**Actions** → botón verde **New repository secret**.

Crea estos cuatro:

| Name | Secret |
|---|---|
| `DANI_EMAIL` | tu correo de Biwenger |
| `DANI_PASSWORD` | tu contraseña de Biwenger |
| `ANA_EMAIL` | el correo de Ana |
| `ANA_PASSWORD` | la contraseña de Ana |

**Cómo lo hace Ana sin decirte su contraseña.** Añádela como colaboradora en
**Settings → Collaborators**, y que entre ella misma a crear `ANA_EMAIL` y
`ANA_PASSWORD`. Los secretos se escriben pero no se pueden leer después, ni
siquiera por el dueño del repo: tú verás que existen, no su contenido.

Si el patrón de URL de las imágenes no coincidiera (la fase 0 te lo dice),
añade `BIWENGER_PLAYER_IMG` y `BIWENGER_TEAM_IMG`. Si una imagen falla, la app
enseña las iniciales del jugador y sigue funcionando.

Si tu liga tiene un ajuste de puja máxima distinto del habitual, añade también
`BIWENGER_BID_MODE` con `saldo`, `saldo25`, `saldo50` o `ilimitada`. Lo miras en
Biwenger → Ajustes → Mercado → Compras y Ventas. Por defecto usa `saldo25`.

---

## Parte 3 · La primera ejecución (importante)

Antes de nada hay que ver qué forma tienen los datos reales de Biwenger.

1. Pestaña **Actions**. Si pide confirmación para activar los workflows,
   acéptala.
2. En la lista de la izquierda, **"Fase 0 - ver los datos"** → botón
   **Run workflow**.
3. Espera un minuto, entra en la ejecución y abre el paso **"Mostrar el
   resumen"**.

Verás tres bloques que responden a tres preguntas: si el mercado trae el número
de pujas, si el calendario trae los próximos partidos, y si viene la
clasificación.

**Pásame ese texto.** El adaptador está escrito sobre suposiciones y ahí es
donde se confirman. Sobre todo los minutos por jornada: si la API no los da, la
proyección trabaja con una aproximación.

Si falla el login, lo más probable es que haya cambiado la ruta. Pásame también
el error.

---

## Parte 4 · Publicar la web en Vercel

1. Entra en vercel.com y regístrate **con tu cuenta de GitHub**.
2. **Add New → Project**. Te lista tus repos: elige este e **Import**.
3. No toques nada de la configuración. El `vercel.json` ya le dice qué hacer:
   ejecutar `npm run build:web` y publicar la carpeta `public`.
4. **Deploy**. En un minuto te da una URL tipo
   `biwenger-moneyball.vercel.app`.

Esa URL es la app. Ábrela en el móvil y añádela a la pantalla de inicio: se
comporta como una app normal.

- Tú entras en `tu-proyecto.vercel.app/?u=dani`
- Ana entra en `tu-proyecto.vercel.app/?u=ana`

También se puede cambiar desde el botón **⚙** dentro de la app. La elección se
recuerda, así que cada una lo hace una sola vez.

Hasta que corra el primer análisis nocturno, la app enseña los datos de
demostración con jugadores reales de LaLiga. Es normal.

---

## Parte 5 · Que funcione solo

El workflow **"Snapshot diario"** ya está programado a las 02:15. Cada noche:

1. Entra en Biwenger con las credenciales de cada una.
2. Calcula recomendaciones de fichaje, venta y alineación.
3. Guarda `data/market-dani.json` y `data/market-ana.json` en el repo.
4. Ese commit hace que Vercel republique la web sola.

Para no esperar a mañana, lánzalo a mano: **Actions → Snapshot diario →
Run workflow**.

### Alertas por Telegram (opcional)

1. En Telegram, habla con `@BotFather`, manda `/newbot` y sigue los pasos. Te
   da un token.
2. Escríbele algo a tu bot recién creado.
3. Para saber tu chat id, habla con `@userinfobot`.
4. Añade dos secretos más: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.

Cada noche te avisará si aparece alguien con nota 8 o más.

---

## Qué se ve y qué no

**Público** (el repo lo es): el código, y los `market-*.json` con vuestro
mercado, plantillas y recomendaciones.

**Privado**: las contraseñas, que viven cifradas en los secretos de GitHub y no
se pueden leer una vez escritas.

Si os incomoda que los JSON sean visibles, la alternativa es un repo privado
más Vercel en plan de pago, o servirlo desde una máquina vuestra.

---

## Si algo se tuerce

| Síntoma | Causa más probable |
|---|---|
| No aparece la pestaña Actions | Falta la carpeta `.github/workflows` |
| Login falló (401/403) | Cambió la ruta de login, o credenciales mal |
| La app enseña la demo | Todavía no ha corrido el snapshot, o el JSON no tiene tu nombre |
| Vercel da 404 | El build no encontró `web/index.html` |
| Notas raras o todo a 4,9 | El adaptador no está ajustado: hace falta la fase 0 |

Para comprobar que el motor sigue sano en cualquier momento:

```bash
npm run archetypes   # Spearman debe superar 0,85
npm run validate     # el modelo debe ganar a la heurística tonta
```
