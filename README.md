# Biwenger Moneyball

Motor de decisión para el mercado de Biwenger. Recomienda qué fichar, qué vender
y cuál es el máximo que deberías pagar por alguien, con el techo calculado a
partir del coste de oportunidad de tu presupuesto.

Es de **solo lectura**. No ejecuta pujas ni ventas: te dice qué hacer, tú pulsas.
Automatizar escrituras choca con las normas de Biwenger.

## Arranque

Requisito: **Node 22.5 o superior**. No hay dependencias nativas: el
almacenamiento usa el SQLite incluido en Node, así que no necesitas Python ni
compilador. Solo dos paquetes, `dotenv` y `express`, ambos JavaScript puro.

```bash
npm install
cp .env.example .env     # basta con BIWENGER_EMAIL y BIWENGER_PASSWORD
npm run inspect          # FASE 0: vuelca el JSON crudo a ./data/raw
```

Con email y contraseña no hace falta DevTools: el cliente canjea las
credenciales por un token y descubre tu liga y tu usuario desde `/api/v2/account`.
Si tienes varias ligas coge la primera y te lo dice por consola; fija
`BIWENGER_LEAGUE` para elegir otra.

La alternativa sin contraseña es pegar el token: abre biwenger.as.com logueado,
F12, pestaña Network, filtra por `api/v2`, pincha cualquier petición y copia de
Request Headers el `authorization` (sin el `Bearer `), el `x-league` y el
`x-user`. Con token hacen falta los tres.

## Qué hacer con la fase 0

`npm run inspect` no calcula nada a propósito. Baja los endpoints y los vuelca
tal cual, más un `_summary.json` con la forma de cada uno. Mira esos ficheros y
ajusta **`src/biwenger/adapter.ts`**, que es la única capa del proyecto que
depende de cómo responda la API. Todo lo demás trabaja sobre tipos propios.

Los supuestos que hay que confirmar están marcados con `TODO(fase0)`. Los
principales:

- El mapeo de códigos de posición (¿1 es portero?).
- Dónde viven los minutos jugados por jornada. Ahora mismo hay una heurística
  provisional que asume 90 minutos si el jugador puntuó algo, y eso ensucia toda
  la proyección. Es lo primero que hay que arreglar.
- La forma de `market` (¿`sales`, `offers`, array pelado?).
- De dónde sale la jornada en curso.
- Si la ruta de login es la correcta, en caso de usar email y contraseña.

## Uso diario

```bash
npm run snapshot    # baja, guarda, calcula y avisa por Telegram
npm run serve       # API en :8787 para el front
npm run backtest    # compara el modelo contra la heurística tonta
```

Programa `snapshot` de madrugada, que es cuando rota el mercado. Con cron:

```
15 2 * * * cd /ruta/al/proyecto && /usr/bin/npm run snapshot >> ./data/cron.log 2>&1
```

Guardar cada día importa: la API no da histórico retroactivo de precios ni de
ofertas, así que cada día que no corre el job es una foto que se pierde para
siempre. Y sin histórico no hay backtest.

## Puesta en marcha completa

Ver `DESPLIEGUE.md`.

## Conectar el front

`npm run snapshot` escribe `data/market.json`, que es el contrato que consume la
app. Para leerlo desde el móvil hay un obstáculo: **una página servida por HTTPS
no puede leer de una URL HTTP**, así que apuntar la app a `http://tu-ip:8787` no
funciona. Tres salidas, de menos a más trabajo:

1. **Pegar el JSON.** Abre `data/market.json`, copia y pégalo en el panel ⚙ de
   la app. Cero infraestructura, pero manual cada día.
2. **GitHub Actions.** El workflow de `.github/workflows/snapshot.yml` corre
   cada madrugada y commitea un `data/market-<slug>.json` por manager. La URL
   `raw.githubusercontent.com` es HTTPS y permite CORS, así que la app la lee
   directamente. No necesitas tener el ordenador encendido, y el alta se puede
   hacer entera desde el navegador.

   Secretos en Settings → Secrets and variables → Actions:
   `DANI_EMAIL`, `DANI_PASSWORD`, `AMIGO_EMAIL`, `AMIGO_PASSWORD`, y
   opcionalmente `BIWENGER_LEAGUE` si alguno juega varias ligas.

   Hay una ejecución por manager a propósito: el techo de puja depende de la
   plantilla y del saldo de cada uno, así que el mismo mercado da números
   distintos. Para añadir a alguien, una entrada más en la matriz y sus dos
   secretos.

   El repo tiene que ser público para que la app pueda leer el JSON sin
   autenticarse. El JSON lleva el mercado y las plantillas, nunca credenciales,
   pero conviene saberlo.
3. **Tu propio servidor con HTTPS.** `npm run serve` más un túnel (Cloudflare
   Tunnel da una URL HTTPS gratis). `server.ts` ya manda las cabeceras CORS.

## Cómo decide

La unidad no son puntos, son **puntos sobre el nivel de reemplazo**. El
reemplazo es el mejor jugador libre de esa posición en tu liga, y se recalcula
cada día.

El motor proyecta las próximas jornadas en vez de calificar el pasado:

```
PtsProy = P(juega) × minutos_esperados × pts/90_regresados × ajuste_calendario
```

`pts/90_regresados` encoge lo observado hacia la mediana de su posición según el
tamaño de muestra (`SHRINKAGE_K`). Con pocos partidos el modelo casi no se cree
lo que ve, que es lo que evita enamorarse de tres partidazos.

El techo de puja sale del precio sombra del presupuesto, **λ**, calculado como
derivada numérica de la frontera eficiente en tu saldo actual:

```
Techo = (PtsProy_jugador − PtsProy_del_que_desplaza) / λ
```

Con λ = 1,2 pts/M€ y un jugador que aporta 14 puntos más que el titular al que
echa del once, el techo son 11,7M€. Un euro más y ese dinero rinde mejor en otro
sitio.

Las ventas usan la misma ecuación girada: vendes cuando el mercado te paga más
de lo que el jugador vale **para ti**, que es su diferencia con quien ocuparía su
hueco. Por eso el sistema te dice que vendas a un buen delantero si ya tienes
dos mejores: su nota individual da igual, no cabe en el once.

La nota 0-10 es un percentil dentro de la posición, no un umbral inventado. Un 8
significa que está en el top del pool comparable.

## Calibración

### Sistema de puntuación

Configurado para el **mixto (media de Diario AS y SofaScore, redondeada)**, que
es el que usa nuestra liga. No es un detalle menor: la media de dos sistemas es
bastante menos volátil que las picas solas y tiene granularidad mucho más fina,
y eso cambia los priores, la regresión y el umbral de irregularidad.

### Datos de demostración

`npm run sample` genera la demo del front con **jugadores reales** de LaLiga
2026/27: nombres, equipos, posiciones y puntos jornada a jornada del sistema
AS+Sofascore. Los precios son los de Biwenger donde los tengo contrastados
(14 jugadores) y estimados en el resto, marcados con `precioReal: false` para
que la app los muestre con `≈`.

Lo único inventado es la liga: quién tiene a quién, tu saldo y qué hay hoy en
el mercado. Eso no existe hasta que conectas tu cuenta.

Los precios reales enseñan por sí solos la ineficiencia que persigue el
modelo: Camello lleva 65 puntos y vale 7,2M, Bellingham 61 y vale 18,7M. Fer
Niño tiene los mismos 55 que Fermín y cuesta cuatro veces menos. El precio va
detrás de la fama y de la temporada pasada, no del rendimiento de esta.

### Dos bancos de pruebas

`npm run validate` valida **fuera de muestra con datos reales** de LaLiga
2026/27: entrena con las primeras jornadas y compara contra lo que esos mismos
jugadores hicieron después. El modelo nunca ve las jornadas de prueba.

| Corte | r modelo | r heurística tonta | MAE modelo | MAE tonta |
|---|---|---|---|---|
| 3 jornadas | **0,622** | 0,582 | **2,12** | 2,60 |
| 4 jornadas | **0,535** | 0,467 | **2,68** | 3,07 |
| 5 jornadas | **0,500** | 0,411 | **3,54** | 3,75 |

Le gana a la heurística tonta en las tres ventanas, y por más margen en el
error que en la correlación.

`npm run archetypes` usa un simulador con las **reglas reales de puntuación**: base AS -2/2/6/10/14 según picas, base SofaScore por
tramos de nota, media de las dos redondeada; gol POR 6 · DEF 5 · MED 4 · DEL 3,
penalti 3, portería a cero POR/DEF 3 · MED 1, goles encajados POR -1, roja -6,
doble amarilla -3, y sin calificar por debajo de 10 minutos.

La distribución del simulador está ajustada contra la real medida en 399
puntuaciones: mediana 4, percentil 90 en 13, máximo 23, negativos por debajo
del 5%, desviación típica por jugador con mediana 3,6. Por posición la media
real es POR 5,21 · DEF 4,17 · MED 6,54 · DEL 6,67, lo que confirma que los
priores tienen que ir por posición.

Cada jugador simulado tiene una calidad latente que el modelo no ve. La prueba
es si la recupera. Resultados del barrido sobre 1.600 jugadores:

| Cambio | Spearman | Error medio |
|---|---|---|
| Punto de partida | 0,827 | 6,55 |
| Titularidad ponderada por recencia | 0,909 | 5,98 |
| k y forma recalibrados (antes 7 y 4) | 0,93 | 4,7 |
| Ritmo por aparición, no por 90 min | **0,936** | **4,46** |

Lo que se arregló y por qué:

- **`SHRINKAGE_K` de 7 a 4, `FORM_HALFLIFE` de 4 a 8.** El simulador prefiere
  k=3, los datos reales k=5, y entre esos valores la diferencia está dentro del
  ruido: 4 es el consenso. Lo que ambos bancos sí descartan con claridad es el
  7 original. Con la forma pasa igual: los datos reales prefieren vidas medias
  largas, pero solo cubren 6 jornadas, donde todavía no hay racha que detectar.
- **Titularidad ponderada por recencia** en vez de ventana fija de 6 jornadas.
  A un titular indiscutible con dos descansos dentro de la ventana le salía
  0,63 cuando la realidad era 0,92, y eso hundía su proyección a la mitad.
- **Ritmo por aparición, no por 90 minutos.** En Biwenger las picas se dan por
  actuación: quien juega 65 minutos recibe la misma valoración del cronista que
  quien juega 90. Solo los extras por gol escalan con el tiempo.
- **Prior con media recortada, no mediana.** Las puntuaciones están sesgadas a
  la derecha, así que la mediana queda por debajo de la media y regresar hacia
  ella empujaba a toda la liga hacia abajo.
- **Apariciones de menos de 10 minutos fuera del cálculo del ritmo.** Biwenger
  no las califica, así que sumaban minutos en los que era imposible puntuar.
- **Umbral de irregularidad autocalibrado.** Estaba fijo en 3, pero la
  desviación típica mediana real es 4,02: marcaba como irregular al 79% de la
  liga.

Una advertencia sobre el banco real: son 72 jugadores y 6 jornadas. Detecta
errores grandes, pero no afina parámetros — ahí todas las configuraciones
quedan empatadas. La potencia estadística la pone el simulador; los datos
reales confirman la dirección. Y la muestra está sesgada hacia jugadores
conocidos, así que sus medias absolutas están infladas respecto a la liga
entera (~3 puntos por jugador y jornada).

Un apunte sobre los datos de prueba: las jornadas reales que tengo no dicen
dónde se jugó cada partido, así que ese campo va sin definir. Antes lo rellenaba
alternando local y visitante, lo cual era inventárselo, y encima alimentaba con
ruido la medición de ventaja de campo, que es una calibración real del motor.

Queda una compresión hacia la media (los muy buenos algo infravalorados, los
malos algo sobrevalorados). Es inherente a la regresión y es lo que minimiza el
error: no es un fallo que convenga "arreglar".

## Presentación de las puntuaciones

Las puntuaciones usan el **código de color de Biwenger**, el mismo que ves en el
juego:

| Puntuación | Color |
|---|---|
| Negativa | Rojo |
| 0 | Gris |
| 1 a 5 | Naranja |
| 6 a 9 | Verde |
| 10 o más | Azul |

Cada tarjeta lleva una fila con las **últimas seis jornadas** en pastillas, más
el total de temporada y los partidos jugados.

Al desplegar, el histórico tiene la misma forma que la pestaña PUNTOS de
Biwenger: jornada, escudos de ambos equipos con el resultado, barra
proporcional coloreada con el número dentro, e iconos de eventos a la derecha
(⚽ gol, ➡️ asistencia, 🥅 en propia, 🧤 penalti parado, ❌ penalti fallado, y
tarjetas amarilla y roja).

Hay una distinción que importa y que se ve: **no jugó** (pastilla vacía con
borde discontinuo) no es lo mismo que **jugó y sacó cero** (pastilla gris). En
el sistema mixto un jugador puede disputar los 90 minutos y quedarse en 0, y
confundir ambos casos era uno de los fallos que arrastraba el adaptador.

## Qué hay en el desplegable de cada jugador

- **Medias en casa 🏠 y fuera ✈️**, con los partidos de cada una.
- **Rejilla jornada a jornada** con la puntuación en pastilla de color.
- **Histórico**: jornada, dónde se jugó, rival, puntos, minutos, y goles ⚽ y
  asistencias ➡️ de ese partido. Ordenado de más reciente a más antiguo.
- **Evolución del valor de mercado** de los últimos doce meses.

El rival, el campo, los goles y las asistencias **solo vienen en la ficha del
jugador**, no en el dataset de competición. El snapshot ya baja esa ficha para
el histórico de precios, así que se aprovecha la misma petición.

Las columnas se adaptan: si un dato no está disponible, su columna no aparece
en vez de mostrarse vacía.

## Fotos, escudos y gráfica de precios

Las fotos y los escudos salen del CDN de Biwenger, con un esquema de rutas
cortas comprobado contra el servidor real:

| Qué | URL |
|---|---|
| Jugador | `https://cdn.biwenger.com/i/p/{id}.png` |
| Equipo | `https://cdn.biwenger.com/i/t/{id}.png` |
| Manager | `https://cdn.biwenger.com/{icon}` |

La pista para dar con ello estaba en la clasificación de la liga, donde cada
manager trae `icon: "i/u/12982480.png"`. Si los usuarios van en `i/u/`, el resto
sigue el mismo patrón.

Son configurables con `BIWENGER_PLAYER_IMG` y `BIWENGER_TEAM_IMG` por si el
esquema cambia. Si una imagen no carga, la app enseña las iniciales del jugador:
nunca se rompe por eso.

La gráfica de evolución del precio usa el campo `prices` de la ficha de
jugador, que es el mismo dato con el que Biwenger dibuja la suya. El snapshot
baja la ficha **solo de los jugadores que salen en la app** (mercado y tu
plantilla, unos 40): bajar las 500 costaría varios minutos de peticiones para
datos que nadie va a mirar.

## Cómo se valora un fichaje

La pregunta NO es "¿a qué jugador de su posición sustituye?". Es **"¿cuánto
sube mi mejor once si lo ficho?"**:

```
delta = bestXI(plantilla + jugador) − bestXI(plantilla)
```

`bestXI` prueba las seis formaciones, así que esto resuelve de golpe tres cosas
que la comparación por posición no veía:

- **A quién desplaza de verdad**, que puede ser de otra posición. Fichar un
  medio puede hacer que te convenga pasar de 4-3-3 a 3-4-3 y el que sale del
  once es un defensa. Verificado con un caso de prueba.
- **Que no desplace a nadie**: entonces la mejora es cero y su valor está solo
  en la revalorización, que es exactamente lo que pasa con un suplente barato
  comprado como inversión.
- **Que salgan varios a la vez**: entra un portero mejor y además se reajusta
  el esquema.

Las ventas usan el mismo criterio girado: lo que aporta un jugador es cuánto
caería tu mejor once sin él, no su diferencia con el suplente de su posición.

Y el precio sombra lambda mide **lo mismo**. Si el numerador y el denominador
no usan la misma definición de "mejora", los techos salen inflados sin que se
note: con la valoración por once y lambda por intercambios, los fichajes
recomendados pasaban de dos a ocho.

## Comparador uno contra uno

Dentro de la ficha de cualquier jugador del mercado hay un desplegable con toda
tu plantilla. Eliges **tú** por quién lo cambiarías y se recalcula el cara a
cara para esa pareja concreta: proyección, puntos de temporada, media, goles,
asistencias, titularidad, regularidad, valor de mercado y revalorización, con el
mejor de cada fila marcado.

Abajo, el veredicto de ESE cambio: cuántos puntos ganas, cuánto te cuesta neto
(pagas uno, ingresas al otro) y el máximo que deberías pagar por esa operación
en concreto.

Viene preseleccionado el jugador que el motor considera que desplazarías, pero
es solo una sugerencia: su criterio es maximizar el once, y tú puedes tener
otros motivos para querer quitarte a alguien de encima.

## Dos notas, no una

Un jugador puede ser magnífico y una compra pésima. Mezclarlo en un solo número
confunde, así que van separados:

- **Calidad del jugador**: percentil de su proyección dentro de su posición.
- **¿Compensa el precio?**: si el techo supera lo que piden.

Lamine Yamal sale con 9,1 de calidad y 4,9 de operación, y la razón lo dice con
palabras: *gran jugador, pero piden 4M€ más de lo que te aporta a ti*.

## Revalorización

El techo de un fichaje tiene **dos partes**, y antes solo se contaba una:

```
Techo = valor de sus puntos + plusvalía esperada
```

Un titular barato puede aportar pocos puntos y ser aun así buena operación,
porque su precio va a subir. Y la plusvalía es dinero igual de real: si compras
a 500.000 € y en seis jornadas vale 1,5M, has ganado un millón.

La mecánica es la misma ineficiencia de siempre: el precio de Biwenger reacciona
a los puntos ya marcados, así que va por detrás. Se ajusta por posición una
recta `precio ≈ a + b · proyección`, recortando los extremos para que un par de
estrellas con sobreprecio de fama no tuerzan el ajuste, y se mide el desfase de
cada jugador.

Dos detalles que costaron un par de intentos:

- **La convergencia va en escala logarítmica**, no en euros. Biwenger mueve los
  precios en porcentaje del valor actual: un jugador de 500.000 € puede doblar
  en semanas mientras uno de 25 millones se mueve un 5%. Con aproximación lineal,
  el tope aplastaba a todos los baratos al mismo número.
- **La saturación es suave** (tangente hiperbólica). Con un corte seco, dos
  jugadores de 500.000 € salían iguales proyectasen 18 puntos o 30.

La velocidad de convergencia es el parámetro más flojo del sistema: no tengo con
qué calibrarlo. En cuanto el snapshot acumule unas semanas de `priceHistory` se
puede medir de verdad, comparando el desfase de cada jornada con lo que el precio
hizo después. Mientras tanto va deliberadamente conservador.

## Mejoras que no cuestan dinero

Cuando un jugador del mercado es **mejor y más barato** que uno de los tuyos, no
es un fichaje normal: es dinero gratis. Salen destacadas arriba del mercado,
porque son lo primero que hay que hacer y antes quedaban enterradas entre el
resto.

## El parámetro que más silenciosamente puede estropearlo todo

Las URLs de Biwenger llevan un parámetro `score`, y decide **en qué sistema de
puntuación vienen los datos**: los puntos, el `fitness` y el desglose casa/fuera
del dataset cambian según lo que pidas.

Por eso la liga se consulta SIEMPRE primero: es quien dice cuál es el sistema
bueno (`scoreID`), y ese número se mete en las llamadas siguientes. Pedirlos con
el sistema equivocado devuelve números de otra liga y **nada falla a la vista**:
el modelo trabaja tan tranquilo sobre datos ajenos.

## Reintentos

Biwenger tiene Cloudflare delante y responde 403 cuando le llegan muchas
peticiones seguidas, aunque el token sea válido. El cliente reintenta tres veces
esperando 2, 6 y 14 segundos. Un 401 no se reintenta: ahí el token es malo de
verdad y insistir no arregla nada.

## Economía

Hay **dos techos** por jugador y manda el más bajo:

- **Techo de valor**: lo que el jugador merece la pena, `(puntos extra) / λ`.
- **Límite de puja**: lo que Biwenger te deja ofrecer, según el ajuste de tu
  liga (Ajustes → Mercado → Compras y Ventas):

| `BIWENGER_BID_MODE` | Límite |
|---|---|
| `saldo` | solo el saldo, sin poder quedar en negativo |
| `saldo25` | saldo + 25% del valor de plantilla (el que recomienda Biwenger) |
| `saldo50` | saldo + 50% |
| `ilimitada` | sin tope |

### Frescura de los datos

El snapshot corre de madrugada. Los **precios y el valor de plantilla** los
actualiza Biwenger también de madrugada, así que van al mismo ritmo y no se
desfasan. El **saldo** sí: cambia en cuanto compras o vendes.

Por eso la app deja ajustarlo en local, sin red: marcas una venta en la ficha
del jugador o metes un ajuste manual en euros, y recalcula saldo, margen y
límite al vuelo. Se guarda en el navegador.

Ojo a un detalle que es fácil equivocarse: vender no sube tu límite por el
precio completo. El jugador sale de la plantilla, así que el margen de deuda
baja también. Con el modo `saldo25`, vender por 13,5M sube el límite solo 10,1M.

Y el riesgo que casi nadie calcula: **pujar por varios a la vez**. Cada puja
puede caber por separado y la suma no. Biwenger te deja quedarte en negativo,
pero si no cierras en positivo antes de la jornada tu equipo no puntúa. El plan
de liquidez ordena las pujas por prioridad, marca a partir de cuál dejas de
estar cubierto, y dice qué ventas taparían el agujero.

## Qué tiene en cuenta el modelo

| Factor | Estado |
|---|---|
| Probabilidad de ser titular | Sí. Minutos sobre disponibles en las últimas 6 jornadas, por el estado (lesión, sanción, duda) |
| Forma reciente | Sí. Media ponderada exponencialmente |
| Fiabilidad | Sí. Desviación típica de sus puntuaciones |
| Regresión a la media | Sí. Encoge lo observado según tamaño de muestra |
| Ventaja de jugar en casa | Medida sobre los datos de la competición y aplicada para normalizar el pasado. Para el futuro hace falta el calendario |
| Rival de las próximas jornadas | Implementado en `fixtures.ts`, a la espera del calendario |
| Calidad del equipo propio y rival | Sí. Una sola estimación con tres fuentes: temporada (45%), forma reciente (35%) y clasificación (20%) |
| Forma reciente del equipo | Sí. Ponderación exponencial con vida media de 3 jornadas |
| Clasificación | Opcional: se usa si la API la expone, si no se prescinde |
| xG / xA | No |

Las tres fuentes de calidad de equipo se **mezclan**, no se multiplican, porque
miden en gran parte lo mismo: la posición en la tabla es un resumen de los
resultados, y los puntos Biwenger de sus jugadores también. Tratarlas como
factores independientes haría que un rival fuerte penalizase el triple de lo
que debe.

La ventaja de campo no se asume, se mide: si los datos no muestran diferencia,
el factor queda en 1 y no distorsiona nada. Con muestra insuficiente también
devuelve 1.

## Lo que todavía no hace

- **xG y xA.** El ajuste de calendario está a 1 (neutro) y `teamStrength` sin
  alimentar. Esta es la capa que da la ventaja real, pero va después de validar
  que el motor base le gana a la heurística tonta. Así sabremos cuánto aporta.
- **Curva de cierres de tu liga.** La puja sugerida usa un reparto fijo del
  margen. Cuando el histórico tenga suficientes ventas observadas, se sustituye
  por la probabilidad real de ganar la subasta.
- **Front.** La API ya sirve los datos; la PWA viene después.

## Estructura

```
src/
  biwenger/     client, endpoints, adapter  <- lo único acoplado a la API
  domain/       tipos propios
  engine/       regression, projection, replacement, lambda, decisions
  storage/      SQLite, snapshots diarios
  jobs/         snapshot diario
  scripts/      inspect (fase 0), backtest
  api/          servidor HTTP para el front
  notify/       Telegram
```
