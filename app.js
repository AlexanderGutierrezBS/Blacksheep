/* =========================================================
   BLACKSHEEP · Tienda
   - Trae los productos publicados desde Supabase.
   - Filtros, buscador, ficha de producto y carrito.
   - El pedido se registra en la base (que calcula los precios)
     y se abre WhatsApp con el resumen.
   ========================================================= */
(function () {
  "use strict";

  const CFG = window.BS_CONFIG || {};
  const DEMO = window.BS_DEMO || null;           // solo en la vista previa
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- utilidades ---------- */
  const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
  const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const guardarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  const leerLocal = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };

  function toast(texto) {
    const t = $("#toast");
    t.textContent = texto; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  window.BS_toast = toast;

  /* ---------- acceso a Supabase (como cliente) ---------- */
  async function api(ruta, opciones = {}) {
    const r = await fetch(CFG.supabaseUrl + "/rest/v1/" + ruta, {
      ...opciones,
      headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json", ...(opciones.headers || {}) }
    });
    if (!r.ok) {
      let msg = "Error " + r.status;
      try { const j = await r.json(); msg = j.message || msg; } catch (e) { /* nada */ }
      throw new Error(msg);
    }
    return r.status === 204 ? null : r.json();
  }

  const fotoUrl = (nombre) => {
    if (!nombre) return "";
    if (DEMO && DEMO.fotos) return DEMO.fotos[nombre] || "";
    return CFG.supabaseUrl + "/storage/v1/object/public/fotos/" + encodeURIComponent(nombre);
  };

  /* Foto según el tamaño elegido (si ese tamaño tiene una propia) */
  const fotoDe = (p, ml) => (ml && p.fotos_tallas && p.fotos_tallas[ml]) || p.foto;

  /* ---------- precios ---------- */
  const ofertaVigente = (p) =>
    !!p.oferta_activa && p.precio_oferta != null && (!p.oferta_hasta || new Date(p.oferta_hasta) > new Date());

  const tallasDe = (p) => p.precios_tallas
    ? Object.keys(p.precios_tallas).filter((k) => p.precios_tallas[k] != null).sort((a, b) => Number(a) - Number(b))
    : [];

  /* Stock: por tamaño si el perfume lo tiene cargado así; si no, el total.
     null = sin dato (no se limita). */
  const stockDe = (p, ml) => {
    if (ml && p.stock_tallas && p.stock_tallas[ml] != null) return Number(p.stock_tallas[ml]);
    return p.stock == null ? null : Number(p.stock);
  };
  const tallaAgotada = (p, ml) => stockDe(p, ml) === 0;
  const tallasConStock = (p) => tallasDe(p).filter((ml) => !tallaAgotada(p, ml));

  function precioDe(p, ml) {
    const of = ofertaVigente(p);
    if (ml) {
      const antes = Number(p.precios_tallas[ml]);
      const ahora = of && p.ofertas_tallas && p.ofertas_tallas[ml] != null ? Number(p.ofertas_tallas[ml]) : antes;
      return { ahora, antes, oferta: ahora < antes };
    }
    const antes = Number(p.precio_publico);
    const ahora = of ? Number(p.precio_oferta) : antes;
    return { ahora, antes, oferta: ahora < antes };
  }

  function precioTarjeta(p) {
    const t = tallasConStock(p).length ? tallasConStock(p) : tallasDe(p);
    if (t.length > 1) {
      const vs = t.map((ml) => precioDe(p, ml));
      const min = vs.reduce((a, b) => (b.ahora < a.ahora ? b : a));
      return { ...min, desde: true };
    }
    return t.length === 1 ? precioDe(p, t[0]) : precioDe(p);
  }

  /* ---------- estado ---------- */
  const estado = {
    productos: [],
    categoria: "Todo",
    texto: "",
    orden: "destacados",
    mostrar: 12,
    whatsapp: "",
    carrito: leerLocal("bs-carrito", [])
  };

  /* Recorrido de la portada: qué perfume cuenta cada momento y con qué palabras.
     Para cambiar uno, se cambia su código (el mismo que figura en el panel) y el texto.
     Si un perfume se queda sin stock o se oculta, su capítulo no se muestra. */
  const CAPITULOS = [
    { codigo: "BS-LATTAFA-KHAMRAH-QAHWA", momento: "Para la noche", relato: "Café recién hecho, canela y vainilla. Rinde más cuando baja el sol, y mucho más cuando baja la temperatura." },
    { codigo: "BS-RASASI-HAWAS-ICE", momento: "Para el calor", relato: "Limón, manzana y un fondo de almizcle limpio. Fresco de verdad, de los que aguantan una siesta pampeana en enero." },
    { codigo: "BS-RIIFFS-MOMENTO", momento: "Para que pregunten", relato: "Extrait de parfum: más concentrado, más horas en la piel. Es el que te hace repetir el nombre dos veces porque no lo conocían." },
    { codigo: "BS-LATTAFA-YARA", momento: "Para todos los días", relato: "Vainilla, frutas tropicales y almizcle. Dulce sin empalagar: va a la oficina, a la facultad y al café de las cinco." }
  ];
  const GENEROS = [["Masculino", "Para él"], ["Femenino", "Para ella"], ["Unisex", "Unisex"]];

  const ORDEN_CAT = ["Nicho", "Diseñador", "Árabe", "Victoria's Secret", "Indonesia", "Kits", "Cuidado Personal"];

  /* ---------- carga ---------- */
  async function cargar() {
    pintarEsqueleto();
    try {
      if (DEMO) {
        estado.productos = DEMO.productos;
        estado.whatsapp = DEMO.whatsapp || "";
      } else {
        const cols = "codigo,nombre,marca,linea,concentracion,genero,familia,ml,categoria,acordes,adn,salida,corazon,fondo,foto," +
          "precio_publico,precio_oferta,precios_tallas,ofertas_tallas,oferta_activa,oferta_porcentaje,oferta_hasta,agotado,stock,stock_tallas,perfil,fotos_tallas";
        const todos = [];
        for (let desde = 0; ; desde += 1000) {
          const lote = await api(`productos?select=${cols}&visible=eq.true&precio_publico=not.is.null&order=codigo&limit=1000&offset=${desde}`);
          todos.push(...lote);
          if (lote.length < 1000) break;
        }
        estado.productos = todos;
        const aj = await api("ajustes?select=clave,valor");
        estado.whatsapp = (aj.find((a) => a.clave === "whatsapp") || {}).valor || "";
      }
      pintarChips();
      pintarGrilla();
      pintarCarrito();
      pintarAnuncios();
      pintarPortada();
    } catch (e) {
      $("#grilla").innerHTML = `<div class="vacio-grilla"><b>No pudimos cargar la tienda</b>Revisá tu conexión y volvé a intentar. (${esc(e.message)})</div>`;
      $("#cuenta").textContent = "";
    }
  }

  /* Barra de anuncios: si hay ofertas activas, se anuncian solas */
  function pintarAnuncios() {
    const ofertas = estado.productos.filter(ofertaVigente).length;
    const textos = ["100% originales", "Árabes · Diseñador · Nicho", "Pedidos por WhatsApp", "Santa Rosa · La Pampa"];
    if (ofertas) textos.unshift(ofertas === 1 ? "1 producto en oferta" : `${ofertas} productos en oferta`);
    const tira = textos.map((t) => `<span>${esc(t)}</span>`).join("");
    $("#anuncios-pista").innerHTML = tira + tira;
  }

  /* Portada: cifras reales y recorrido por los perfumes destacados */
  function pintarPortada() {
    const ps = estado.productos;
    if (ps.length) {
      $("#dato-cantidad").textContent = ps.length.toLocaleString("es-AR");
      $("#dato-casas").textContent = new Set(ps.map((p) => p.marca).filter(Boolean)).size;
    }
    $("#recorrido").innerHTML = CAPITULOS.map((c) => {
      const p = ps.find((x) => x.codigo === c.codigo);
      if (!p || p.agotado || !p.foto) return "";
      const f = p.perfil || {};
      const pr = precioTarjeta(p);
      const deDia = Number(f.dia) >= Number(f.noche);
      return `<article class="capitulo">
        <div class="nicho rev"><img src="${esc(fotoUrl(p.foto))}" alt="${esc((p.marca || "") + " " + p.nombre)}" loading="lazy" width="800" height="1000"></div>
        <div>
          <p class="rotulo rev"><b>${esc(c.momento)}</b></p>
          <h2 class="rev" style="--d:1">${esc(p.nombre)}</h2>
          ${p.marca ? `<p class="de rev" style="--d:1">de ${esc(p.marca)}</p>` : ""}
          <p class="relato rev" style="--d:2">${esc(c.relato)}</p>
          ${Array.isArray(f.notas) && f.notas.length ? `<ul class="notas-lista rev" style="--d:3" aria-label="Notas olfativas">${f.notas.slice(0, 5).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
          <p class="fila-datos rev" style="--d:4">${f.longevidad ? `<span>Dura <b>${esc(f.longevidad)}</b></span>` : ""}${f.estela ? `<span>Estela <b>${esc(f.estela)}</b></span>` : ""}${f.dia != null && f.noche != null ? `<span><b>${deDia ? f.dia : f.noche}%</b> ${deDia ? "de día" : "de noche"}</span>` : ""}</p>
          <div class="pie-capitulo rev" style="--d:5">
            <span class="precio-grande">${pr.desde ? "Desde " : ""}${pesos(pr.ahora)}${pr.oferta ? `<s>${pesos(pr.antes)}</s>` : ""}</span>
            <button class="boton" type="button" data-ficha="${esc(p.codigo)}">Ver ficha <span class="flecha"></span></button>
          </div>
        </div>
      </article>`;
    }).join("");
    observar();
  }

  function pintarEsqueleto() {
    $("#grilla").innerHTML = Array.from({ length: 8 }, () => `<div class="tarjeta"><div class="esqueleto"></div></div>`).join("");
  }

  /* ---------- filtros ---------- */
  function pintarChips() {
    const cuenta = {};
    estado.productos.forEach((p) => { cuenta[p.categoria] = (cuenta[p.categoria] || 0) + 1; });
    const cats = Object.keys(cuenta).sort((a, b) => {
      const ia = ORDEN_CAT.indexOf(a), ib = ORDEN_CAT.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    const ofertas = estado.productos.filter(ofertaVigente).length;
    const lista = [["Todo", estado.productos.length]];
    if (ofertas) lista.push(["Ofertas", ofertas]);
    GENEROS.forEach(([g, t]) => {
      const n = estado.productos.filter((p) => p.genero === g).length;
      if (n) lista.push(["g:" + g, n, t]);
    });
    if (cats.length > 1) cats.forEach((c) => lista.push([c, cuenta[c]]));
    $("#chips").innerHTML = lista.map(([c, n, t]) =>
      `<button class="chip" type="button" role="tab" data-cat="${esc(c)}" aria-selected="${c === estado.categoria}">${esc(t || c)}<small>${n}</small></button>`
    ).join("");
  }

  function filtrados() {
    const q = normal(estado.texto).trim();
    let lista = estado.productos.filter((p) => {
      if (estado.categoria === "Ofertas" && !ofertaVigente(p)) return false;
      if (estado.categoria.startsWith("g:")) { if (p.genero !== estado.categoria.slice(2)) return false; }
      else if (estado.categoria !== "Todo" && estado.categoria !== "Ofertas" && p.categoria !== estado.categoria) return false;
      if (q) {
        const bolsa = normal([p.nombre, p.marca, p.linea, p.familia, p.acordes, p.categoria].join(" "));
        return q.split(/\s+/).every((pal) => bolsa.includes(pal));
      }
      return true;
    });
    const precio = (p) => precioTarjeta(p).ahora;
    if (estado.orden === "menor") lista.sort((a, b) => precio(a) - precio(b));
    else if (estado.orden === "mayor") lista.sort((a, b) => precio(b) - precio(a));
    else if (estado.orden === "az") lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
    else lista.sort((a, b) =>
      (ofertaVigente(b) - ofertaVigente(a)) ||
      (!!b.foto - !!a.foto) ||
      (!!a.agotado - !!b.agotado) ||
      ((ORDEN_CAT.indexOf(a.categoria) + 99) % 99 - (ORDEN_CAT.indexOf(b.categoria) + 99) % 99) ||
      a.nombre.localeCompare(b.nombre));
    return lista;
  }

  function tarjetaHtml(p, i = 0) {
    const pr = precioTarjeta(p);
    const t = tallasConStock(p).length ? tallasConStock(p) : tallasDe(p);
    const detalle = [p.concentracion, t.length ? t.join(" / ") + " ml" : (p.ml ? p.ml + " ml" : "")].filter(Boolean).join(" · ");
    const foto = p.foto
      ? `<img src="${esc(fotoUrl(p.foto))}" alt="${esc(p.nombre)}" loading="lazy" width="800" height="1000">`
      : `<span class="sin-foto">${esc(p.marca || p.nombre)}</span>`;
    const sello = p.agotado ? `<span class="sello sello-claro">Sin stock</span>`
      : pr.oferta ? `<span class="sello">−${Math.round(p.oferta_porcentaje || (1 - pr.ahora / pr.antes) * 100)}%</span>` : "";
    return `<button class="tarjeta rev${p.agotado ? " agotado" : ""}" type="button" data-codigo="${esc(p.codigo)}" style="--d:${i % 4}">
      <span class="nicho">${foto}${sello}${p.agotado ? "" : `<span class="mas" aria-hidden="true">+</span>`}</span>
      <span class="tarjeta-marca">${esc(p.marca || p.categoria)}</span>
      <span class="tarjeta-nombre">${esc(p.nombre)}</span>
      ${detalle ? `<span class="tarjeta-detalle">${esc(detalle)}</span>` : ""}
      <span class="precio">${pr.desde ? "<small>Desde</small>" : ""}${pesos(pr.ahora)}${pr.oferta ? `<s>${pesos(pr.antes)}</s>` : ""}</span>
    </button>`;
  }

  function pintarGrilla() {
    if (!estado.productos.length) {
      $("#cuenta").textContent = "";
      $("#chips").innerHTML = "";
      $("#grilla").innerHTML = `<div class="vacio-grilla"><b>Colección en camino</b>Estamos cargando el stock nuevo. Mientras tanto, escribinos por WhatsApp o seguinos en Instagram.</div>`;
      $("#ver-mas").hidden = true;
      return;
    }
    const lista = filtrados();
    const visibles = lista.slice(0, estado.mostrar);
    $("#cuenta").textContent = lista.length === 1 ? "1 fragancia" : `${lista.length.toLocaleString("es-AR")} fragancias`;
    $("#grilla").innerHTML = visibles.length
      ? visibles.map((p, i) => tarjetaHtml(p, i)).join("")
      : `<div class="vacio-grilla"><b>Nada por acá</b>Probá con otra marca, otro nombre o mirá todas las categorías.</div>`;
    $("#ver-mas").hidden = lista.length <= estado.mostrar;
    observar();
  }

  /* ---------- ficha ---------- */
  let fichaActual = null;
  function abrirFicha(codigo) {
    const p = estado.productos.find((x) => x.codigo === codigo);
    if (!p) return;
    fichaActual = { p, ml: tallasConStock(p)[0] || tallasDe(p)[0] || null, cant: 1 };
    pintarFicha();
    abrirCapa("#capa-ficha");
  }

  // Cambiar tamaño o cantidad: solo se actualizan foto, precio y botón,
  // sin rearmar la ficha (en iPhone rearmarla hace saltar y hacer zoom).
  function actualizarFicha() {
    const { p, ml, cant } = fichaActual;
    const t = tallasDe(p);
    const pr = t.length ? precioDe(p, ml) : precioDe(p);
    // Las fotos de todos los tamaños ya están en la ficha: solo se muestra la que toca
    const f = fotoDe(p, ml);
    document.querySelectorAll("#ficha .ficha-foto img").forEach((img) => { img.hidden = img.dataset.foto !== f; });
    const precio = $("#ficha .ficha-precio");
    if (precio) precio.innerHTML = `${pesos(pr.ahora)}${pr.oferta ? `<s>${pesos(pr.antes)}</s>` : ""}`;
    const salida = $("#ficha .cantidad output");
    if (salida) salida.textContent = cant;
    const boton = $("#agregar");
    if (boton) boton.textContent = `Agregar · ${pesos(pr.ahora * cant)}`;
  }

  function pintarFicha() {
    const { p, ml, cant } = fichaActual;
    const t = tallasDe(p);
    const pr = t.length ? precioDe(p, ml) : precioDe(p);
    const notas = [["Salida", p.salida], ["Corazón", p.corazon], ["Fondo", p.fondo]].filter(([, v]) => v);
    const acordes = (p.acordes || "").split(/[,;·]/).map((a) => a.trim()).filter(Boolean).slice(0, 8);
    const sub = [p.concentracion, p.genero, p.familia, t.length <= 1 ? ((t[0] || p.ml) ? (t[0] || p.ml) + " ml" : "") : ""].filter(Boolean).join(" · ");
    const fotosFicha = [...new Set([p.foto, ...Object.values(p.fotos_tallas || {})].filter(Boolean))];
    $("#ficha").innerHTML = `
      <div class="nicho ficha-foto">${fotosFicha.length ? fotosFicha.map((f) => `<img src="${esc(fotoUrl(f))}" data-foto="${esc(f)}" alt="${esc(p.nombre)}" width="800" height="1000" decoding="sync"${f === fotoDe(p, ml) ? "" : " hidden"}>`).join("") : `<span class="sin-foto">${esc(p.marca || "")}</span>`}</div>
      <div>
        <p class="rotulo"><b>${esc(p.marca || p.categoria)}</b></p>
        <h3 id="ficha-nombre">${esc(p.nombre)}</h3>
        ${sub ? `<p class="ficha-sub">${esc(sub)}</p>` : ""}
        ${p.adn ? `<p class="ficha-adn">${esc(p.adn)}</p>` : ""}
        ${notas.length ? `<div class="bloque"><p class="rotulo">Pirámide</p><dl class="notas">${notas.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>` : ""}
        ${perfilHtml(p.perfil)}
        ${acordes.length ? `<div class="bloque"><p class="rotulo">Acordes</p><ul class="acordes">${acordes.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
        <div class="bloque">
          ${t.length > 1 ? `<fieldset class="tallas"><legend class="rotulo">Tamaño</legend>${t.map((m) =>
            tallaAgotada(p, m)
              ? `<label class="talla talla-agotada"><input type="radio" name="talla" value="${esc(m)}" disabled><span>${esc(m)} ml <small>Sin stock</small></span></label>`
              : `<label class="talla"><input type="radio" name="talla" value="${esc(m)}" ${m === ml ? "checked" : ""}><span>${esc(m)} ml</span></label>`).join("")}</fieldset>` : ""}
          <p class="ficha-precio">${pesos(pr.ahora)}${pr.oferta ? `<s>${pesos(pr.antes)}</s>` : ""}</p>
          ${p.agotado
            ? `<button class="boton boton-ancho" type="button" disabled>Sin stock</button>`
            : `<div class="ficha-acciones">
                <div class="cantidad"><button type="button" data-cant="-1" aria-label="Uno menos">−</button><output aria-live="polite">${cant}</output><button type="button" data-cant="1" aria-label="Uno más">+</button></div>
                <button class="boton" type="button" id="agregar">Agregar · ${pesos(pr.ahora * cant)}</button>
              </div>`}
        </div>
      </div>`;
  }

  /* ---------- ficha ampliada (notas, duración, día/noche, estaciones) ---------- */
  function perfilHtml(f) {
    if (!f || typeof f !== "object") return "";
    const bloques = [];
    if (Array.isArray(f.notas) && f.notas.length) {
      bloques.push(`<div class="bloque"><p class="rotulo">Notas</p>
        <ul class="notas-lista">${f.notas.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`);
    }
    if (f.longevidad || f.estela) {
      bloques.push(`<div class="bloque duo">
        ${f.longevidad ? `<div><b>${esc(f.longevidad)}</b><span>Duración</span></div>` : ""}
        ${f.estela ? `<div><b>${esc(f.estela)}</b><span>Estela</span></div>` : ""}
      </div>`);
    }
    if (f.dia != null && f.noche != null) {
      const d = Math.max(0, Math.min(100, Number(f.dia))), total = d + Number(f.noche) || 100, pd = Math.round(d / total * 100);
      bloques.push(`<div class="bloque"><p class="rotulo">Cuándo usarlo</p>
        <div class="dianoche" role="img" aria-label="Día ${pd}%, noche ${100 - pd}%">
          <span class="dn-dia" style="width:${pd}%">Día ${pd}%</span><span class="dn-noche">Noche ${100 - pd}%</span>
        </div></div>`);
    }
    const partes = [];
    if (f.estaciones && typeof f.estaciones === "object") {
      const ORDEN = ["Invierno", "Primavera", "Verano", "Otoño"];
      const ent = Object.entries(f.estaciones).sort(([a], [b]) => (ORDEN.indexOf(a) + 9) % 9 - (ORDEN.indexOf(b) + 9) % 9);
      partes.push(`<p class="rotulo">Estaciones</p>
        <div class="estaciones">${ent.map(([k, v]) => { const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); return `
          <div class="estacion"><span>${esc(k)}<b>${n}%</b></span><i style="--n:${n}%"></i></div>`; }).join("")}
        </div>`);
    }
    if (f.puntuacion) {
      const pts = Number(f.puntuacion);
      partes.push(`<p class="puntaje"><b>${pts.toLocaleString("es-AR", { minimumFractionDigits: 1 })}</b>sobre 5
        ${f.votos ? `· ${Number(f.votos).toLocaleString("es-AR")} votos` : ""}${f.fuente ? ` en ${esc(f.fuente)}` : ""}</p>`);
    }
    if (partes.length) bloques.push(`<div class="bloque">${partes.join("")}</div>`);
    return bloques.join("");
  }

  /* ---------- carrito ---------- */
  const claveItem = (codigo, ml) => (ml ? codigo + "@" + ml : codigo);

  function agregar() {
    const { p, ml, cant } = fichaActual;
    const k = claveItem(p.codigo, ml);
    const ya = estado.carrito.find((i) => i.k === k);
    if (ya) ya.cant = Math.min(99, ya.cant + cant);
    else estado.carrito.push({ k, codigo: p.codigo, ml, cant });
    guardarLocal("bs-carrito", estado.carrito);
    pintarCarrito();
    cerrarCapas();
    toast(`${p.nombre} se sumó a tu pedido`);
    const c = $("#contador"); c.classList.remove("salto"); void c.offsetWidth; c.classList.add("salto");
  }

  function lineasCarrito() {
    return estado.carrito.map((i) => {
      const p = estado.productos.find((x) => x.codigo === i.codigo);
      if (!p || p.agotado) return null;
      if (i.ml && !(p.precios_tallas && p.precios_tallas[i.ml] != null)) return null;
      if (tallaAgotada(p, i.ml)) return null;
      const pr = i.ml ? precioDe(p, i.ml) : (tallasDe(p).length === 1 ? precioDe(p, tallasDe(p)[0]) : precioDe(p));
      return { ...i, p, pr };
    }).filter(Boolean);
  }

  function pintarCarrito() {
    const lineas = lineasCarrito();
    const unidades = lineas.reduce((s, l) => s + l.cant, 0);
    const total = lineas.reduce((s, l) => s + l.pr.ahora * l.cant, 0);
    const c = $("#contador");
    c.textContent = unidades; c.classList.toggle("vacio", !unidades);
    $("#carrito-total").textContent = pesos(total);
    $("#enviar-pedido").disabled = !lineas.length;
    $("#carrito-lista").innerHTML = lineas.length ? lineas.map((l) => `
      <div class="linea">
        <div class="nicho linea-foto">${fotoDe(l.p, l.ml) ? `<img src="${esc(fotoUrl(fotoDe(l.p, l.ml)))}" alt="">` : ""}</div>
        <div>
          <p class="linea-nombre">${esc(l.p.nombre)}</p>
          <span class="linea-detalle">${esc([l.p.marca, l.ml ? l.ml + " ml" : (l.p.ml ? l.p.ml + " ml" : "")].filter(Boolean).join(" · "))}${l.pr.oferta ? " · oferta" : ""}</span>
        </div>
        <div class="linea-der">
          <span>${pesos(l.pr.ahora * l.cant)}</span>
          <div class="cantidad"><button type="button" data-linea="${esc(l.k)}" data-mov="-1" aria-label="Uno menos">−</button><output>${l.cant}</output><button type="button" data-linea="${esc(l.k)}" data-mov="1" aria-label="Uno más">+</button></div>
        </div>
      </div>`).join("")
      : `<div class="carrito-vacio"><b>Vacío</b>Todavía no elegiste nada. La vitrina está abierta.</div>`;
  }

  function moverLinea(k, mov) {
    const i = estado.carrito.find((x) => x.k === k);
    if (!i) return;
    i.cant += mov;
    if (i.cant <= 0) estado.carrito = estado.carrito.filter((x) => x.k !== k);
    if (i.cant > 99) i.cant = 99;
    guardarLocal("bs-carrito", estado.carrito);
    pintarCarrito();
  }

  function mensajeWhatsApp(res, nombre, nota) {
    const lineas = res.items.map((it) =>
      `• ${it.cantidad} × ${it.nombre}${it.marca ? " (" + it.marca + ")" : ""}${it.ml ? " " + it.ml + " ml" : ""} — ${pesos(it.subtotal)}${it.en_oferta ? " (oferta)" : ""}`);
    return [
      `¡Hola BLACKSHEEP! 🐑 Te paso mi pedido #${res.numero}`,
      `Nombre: ${nombre}`,
      "",
      ...lineas,
      "",
      `Total: ${pesos(res.total)}`,
      nota ? `Nota: ${nota}` : ""
    ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim();
  }

  async function enviarPedido(ev) {
    ev.preventDefault();
    const nombre = $("#pedido-nombre").value.trim();
    const nota = $("#pedido-nota").value.trim();
    const aviso = $("#aviso-pedido");
    const lineas = lineasCarrito();
    if (!lineas.length) return;
    if (!nombre) { aviso.textContent = "Escribí tu nombre para saber de quién es el pedido."; return; }
    const numero = String(estado.whatsapp || "").replace(/\D/g, "");
    if (!numero && !DEMO) { aviso.textContent = "La tienda todavía no tiene número de WhatsApp cargado. Probá más tarde."; return; }

    const boton = $("#enviar-pedido");
    boton.disabled = true; boton.textContent = "Registrando pedido…"; aviso.textContent = "";
    // En el iPhone, la ventana de WhatsApp tiene que abrirse en el mismo toque
    const ventana = DEMO ? null : window.open("about:blank", "_blank");
    try {
      const items = lineas.map((l) => ({ codigo: l.codigo, ml: l.ml || null, cantidad: l.cant }));
      const res = DEMO
        ? { numero: "1001", total: lineas.reduce((s, l) => s + l.pr.ahora * l.cant, 0),
            items: lineas.map((l) => ({ nombre: l.p.nombre, marca: l.p.marca, ml: l.ml || l.p.ml, cantidad: l.cant, subtotal: l.pr.ahora * l.cant, en_oferta: l.pr.oferta })) }
        : await api("rpc/registrar_pedido", { method: "POST", body: JSON.stringify({ p_items: items, p_cliente: nombre, p_nota: nota || null }) });
      const texto = mensajeWhatsApp(res, nombre, nota);
      if (DEMO) {
        aviso.innerHTML = `Vista previa: en la app publicada se abriría WhatsApp con este mensaje.<br><br>${esc(texto).replace(/\n/g, "<br>")}`;
      } else {
        const url = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
        if (ventana) ventana.location.href = url;
        else aviso.innerHTML = `Pedido #${res.numero} registrado. <a href="${esc(url)}" target="_blank" rel="noopener">Abrí WhatsApp para enviarlo</a>.`;
        estado.carrito = []; guardarLocal("bs-carrito", estado.carrito);
        pintarCarrito();
        toast(`Pedido #${res.numero} registrado`);
      }
    } catch (e) {
      if (ventana) ventana.close();
      aviso.textContent = /no disponible|tamaño/.test(e.message)
        ? "Uno de los productos se quedó sin stock o cambió. Actualizá la página y revisá el carrito."
        : "No se pudo registrar el pedido. Revisá tu conexión y probá de nuevo.";
    } finally {
      boton.disabled = !lineasCarrito().length; boton.textContent = "Enviar pedido por WhatsApp";
    }
  }

  /* ---------- buscador rápido ---------- */
  function pintarResultados() {
    const q = normal($("#buscar-rapido").value).trim();
    const out = $("#resultados");
    if (q.length < 2) { out.innerHTML = ""; return; }
    const lista = estado.productos.filter((p) => {
      const bolsa = normal([p.nombre, p.marca, p.linea, p.familia].join(" "));
      return q.split(/\s+/).every((pal) => bolsa.includes(pal));
    }).slice(0, 12);
    out.innerHTML = lista.length ? lista.map((p) => {
      const pr = precioTarjeta(p);
      return `<button class="resultado" data-codigo="${esc(p.codigo)}">
        ${p.foto ? `<img src="${esc(fotoUrl(p.foto))}" alt="" loading="lazy">` : "<span></span>"}
        <span><span class="tarjeta-marca">${esc(p.marca || "")}</span><br><span class="tarjeta-nombre">${esc(p.nombre)}</span></span>
        <span class="precio">${pesos(pr.ahora)}</span></button>`;
    }).join("") : `<p class="aviso-chico" style="padding:16px 0">Sin resultados para “${esc(q)}”.</p>`;
  }

  /* ---------- capas ---------- */
  let capaAbierta = null;
  function abrirCapa(sel) {
    cerrarCapas();
    const c = $(sel); c.hidden = false; capaAbierta = c;
    document.body.style.overflow = "hidden";
    const foco = c.querySelector("input, .cerrar"); if (foco) setTimeout(() => foco.focus(), 50);
  }
  function cerrarCapas() {
    $$(".capa").forEach((c) => { c.hidden = true; });
    capaAbierta = null; document.body.style.overflow = "";
  }

  /* ---------- vistas: tienda / panel ---------- */
  function rutear() {
    const panel = location.hash === "#panel";
    $("#vista-tienda").hidden = panel;
    $("#vista-panel").hidden = !panel;
    if (panel && window.BS_PANEL) window.BS_PANEL.mostrar();
  }

  /* ---------- eventos ---------- */
  document.addEventListener("click", (e) => {
    const chip = e.target.closest("#chips .chip[data-cat]");
    if (chip) { estado.categoria = chip.dataset.cat; estado.mostrar = 12; pintarChips(); pintarGrilla(); return; }
    const ver = e.target.closest("[data-ficha]");
    if (ver) { abrirFicha(ver.dataset.ficha); return; }
    const tarjeta = e.target.closest(".tarjeta[data-codigo], .resultado[data-codigo]");
    if (tarjeta) { abrirFicha(tarjeta.dataset.codigo); return; }
    if (e.target.closest("[data-cerrar]") || e.target.classList.contains("capa")) { cerrarCapas(); return; }
    const c = e.target.closest("[data-cant]");
    if (c && fichaActual) {
      const tope = stockDe(fichaActual.p, fichaActual.ml);
      const max = tope == null ? 99 : Math.max(1, Math.min(99, tope));
      const nueva = fichaActual.cant + Number(c.dataset.cant);
      if (nueva > max) { toast(max === 1 ? "Queda 1 sola unidad" : `Quedan ${max} unidades`); return; }
      fichaActual.cant = Math.max(1, nueva); actualizarFicha(); return;
    }
    if (e.target.closest("#agregar")) { agregar(); return; }
    const mov = e.target.closest("[data-mov]");
    if (mov) { moverLinea(mov.dataset.linea, Number(mov.dataset.mov)); return; }
  });
  document.addEventListener("change", (e) => {
    if (e.target.name === "talla" && fichaActual) { fichaActual.ml = e.target.value; actualizarFicha(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && capaAbierta) cerrarCapas(); });

  // Si una foto falla (conexión del celular), se vuelve a pedir hasta 2 veces
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.src.includes("/fotos/")) return;
    const n = Number(img.dataset.reintento || 0);
    if (n >= 2) return;
    img.dataset.reintento = n + 1;
    setTimeout(() => { img.src = img.src.split("?")[0] + "?r=" + (n + 1); }, 600 * (n + 1));
  }, true);

  /* ---------- scroll: aparición suave y barra de progreso ---------- */
  let ojo = null;
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("anim");
    ojo = new IntersectionObserver((es) => es.forEach((x) => {
      if (x.isIntersecting) { x.target.classList.add("ya"); ojo.unobserve(x.target); }
    }), { rootMargin: "0px 0px -6% 0px", threshold: .05 });
  }
  function observar() {
    $$(".rev:not(.ya)").forEach((el) => (ojo ? ojo.observe(el) : el.classList.add("ya")));
  }
  let pintando = false;
  window.addEventListener("scroll", () => {
    if (pintando) return; pintando = true;
    requestAnimationFrame(() => {
      const h = document.documentElement;
      $("#progreso").style.transform = `scaleX(${Math.min(1, h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight))})`;
      pintando = false;
    });
  }, { passive: true });

  let tBuscar;
  $("#buscar").addEventListener("input", (e) => {
    clearTimeout(tBuscar);
    tBuscar = setTimeout(() => { estado.texto = e.target.value; estado.mostrar = 12; pintarGrilla(); }, 160);
  });
  $("#orden").addEventListener("change", (e) => { estado.orden = e.target.value; pintarGrilla(); });
  $("#ver-mas").addEventListener("click", () => { estado.mostrar += 12; pintarGrilla(); });
  $("#abrir-carrito").addEventListener("click", () => { pintarCarrito(); abrirCapa("#capa-carrito"); });
  $("#abrir-buscar").addEventListener("click", () => abrirCapa("#capa-buscar"));
  $("#buscar-rapido").addEventListener("input", pintarResultados);
  $("#form-pedido").addEventListener("submit", enviarPedido);
  $("#link-ig").href = "https://instagram.com/" + (CFG.instagram || "_blacksheep.sr");
  $("#pedido-nombre").value = leerLocal("bs-nombre", "");
  $("#pedido-nombre").addEventListener("change", (e) => guardarLocal("bs-nombre", e.target.value.trim()));
  window.addEventListener("hashchange", rutear);

  // para el panel
  window.BS_TIENDA = { recargar: cargar, fotoUrl, pesos, esc };

  observar();
  rutear();
  cargar();
})();
