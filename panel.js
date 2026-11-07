/* =========================================================
   BLACKSHEEP · Panel de administración  (tu-app/#panel)
   - Entrás con tu email y contraseña de Supabase.
   - Solo los emails de la lista "administradores" pueden ver
     y cambiar algo; la base lo controla, no el teléfono.
   ========================================================= */
(function () {
  "use strict";

  const CFG = window.BS_CONFIG || {};
  const DEMO = window.BS_DEMO || null;
  const $ = (s, r = document) => r.querySelector(s);
  const T = () => window.BS_TIENDA;
  const toast = (m) => window.BS_toast && window.BS_toast(m);
  const esc = (t) => T().esc(t);
  const pesos = (n) => T().pesos(n);
  const raiz = $("#vista-panel");

  /* ---------- sesión ---------- */
  let sesion = null;
  try { sesion = JSON.parse(localStorage.getItem("bs-sesion") || "null"); } catch (e) { sesion = null; }
  const guardarSesion = (s) => { sesion = s; try { s ? localStorage.setItem("bs-sesion", JSON.stringify(s)) : localStorage.removeItem("bs-sesion"); } catch (e) { /* nada */ } };

  async function auth(tipo, cuerpo) {
    const r = await fetch(`${CFG.supabaseUrl}/auth/v1/token?grant_type=${tipo}`, {
      method: "POST", headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || "No se pudo entrar");
    return { token: j.access_token, refresh: j.refresh_token, vence: Date.now() + (j.expires_in - 60) * 1000, email: j.user && j.user.email };
  }

  async function tokenVigente() {
    if (!sesion) return null;
    if (Date.now() < sesion.vence) return sesion.token;
    try { guardarSesion(await auth("refresh_token", { refresh_token: sesion.refresh })); return sesion.token; }
    catch (e) { guardarSesion(null); return null; }
  }

  async function api(ruta, opciones = {}) {
    const token = await tokenVigente();
    if (!token) { pintarLogin("Tu sesión venció. Volvé a entrar."); throw new Error("sin sesión"); }
    const r = await fetch(CFG.supabaseUrl + "/rest/v1/" + ruta, {
      ...opciones,
      headers: { apikey: CFG.supabaseKey, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opciones.headers || {}) }
    });
    if (!r.ok) {
      let msg = "Error " + r.status;
      try { const j = await r.json(); msg = j.message || msg; } catch (e) { /* nada */ }
      throw new Error(msg);
    }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  /* ---------- armado general ---------- */
  let pestana = "pedidos";
  const PESTANAS = [["pedidos", "Pedidos"], ["productos", "Productos"], ["formula", "Fórmula"], ["ajustes", "Ajustes"]];

  async function mostrar() {
    if (DEMO) {
      raiz.innerHTML = `<div class="panel-cabeza"><h1>Panel</h1><a href="#inicio" class="cerrar">Volver a la tienda</a></div>
        <div class="panel-caja"><h2>Vista previa</h2><p>El panel funciona en la app publicada: ahí entrás con tu email y manejás pedidos, precios, ofertas y tu WhatsApp.</p></div>`;
      return;
    }
    if (!(await tokenVigente())) return pintarLogin();
    let ok = false;
    try { ok = await api("rpc/es_admin", { method: "POST", body: "{}" }); } catch (e) { return; }
    if (!ok) return pintarLogin(`El email ${sesion.email} no está habilitado como administrador.`);
    pintarMarco();
  }

  function pintarLogin(aviso = "") {
    raiz.innerHTML = `
      <div class="login">
        <div class="panel-cabeza"><h1>Panel</h1><a href="#inicio" class="cerrar">Tienda</a></div>
        <form class="panel-caja" id="form-login">
          <label class="campo" for="login-email"><span>Email</span><input id="login-email" type="email" autocomplete="username" required></label>
          <label class="campo" for="login-clave"><span>Contraseña</span><input id="login-clave" type="password" autocomplete="current-password" required></label>
          <button class="boton boton-ancho" type="submit">Entrar</button>
          <p class="aviso-chico" role="status">${esc(aviso)}</p>
        </form>
      </div>`;
    $("#form-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const aviso = e.target.querySelector(".aviso-chico");
      aviso.textContent = "Entrando…";
      try {
        guardarSesion(await auth("password", { email: $("#login-email").value.trim(), password: $("#login-clave").value }));
        mostrar();
      } catch (err) { aviso.textContent = "Email o contraseña incorrectos."; }
    });
  }

  function pintarMarco() {
    raiz.innerHTML = `
      <div class="panel-cabeza">
        <h1>Panel</h1>
        <div style="display:flex;gap:16px;align-items:center">
          <a href="#inicio" class="cerrar">Ver tienda</a>
          <button class="cerrar" id="salir">Salir</button>
        </div>
      </div>
      <div class="pestanas" role="tablist">${PESTANAS.map(([k, t]) =>
        `<button class="pestana" role="tab" data-pestana="${k}" aria-selected="${k === pestana}">${t}</button>`).join("")}</div>
      <div id="panel-cuerpo"></div>`;
    $("#salir").addEventListener("click", () => { guardarSesion(null); pintarLogin("Saliste del panel."); });
    raiz.querySelectorAll("[data-pestana]").forEach((b) => b.addEventListener("click", () => {
      pestana = b.dataset.pestana;
      raiz.querySelectorAll("[data-pestana]").forEach((x) => x.setAttribute("aria-selected", x === b));
      pintarPestana();
    }));
    pintarPestana();
  }

  function pintarPestana() {
    const c = $("#panel-cuerpo");
    c.innerHTML = `<p class="aviso-chico">Cargando…</p>`;
    ({ pedidos: verPedidos, productos: verProductos, formula: verFormula, ajustes: verAjustes })[pestana](c)
      .catch((e) => { c.innerHTML = `<div class="panel-caja"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></div>`; });
  }

  /* ---------- PEDIDOS ---------- */
  const ESTADOS = [["nuevo", "Nuevo"], ["confirmado", "Confirmado"], ["entregado", "Entregado"], ["cancelado", "Cancelado"]];

  async function verPedidos(c) {
    const pedidos = await api("pedidos?select=*&order=creado.desc&limit=200");
    const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
    const delMes = pedidos.filter((p) => new Date(p.creado) >= inicioMes && p.estado !== "cancelado");
    const vendidos = delMes.filter((p) => p.estado === "confirmado" || p.estado === "entregado");
    c.innerHTML = `
      <div class="resumen-num">
        <div><span>Nuevos sin confirmar</span><b>${pedidos.filter((p) => p.estado === "nuevo").length}</b></div>
        <div><span>Pedidos este mes</span><b>${delMes.length}</b></div>
        <div><span>Vendido este mes</span><b>${pesos(vendidos.reduce((s, p) => s + Number(p.total), 0))}</b></div>
      </div>
      ${pedidos.length ? pedidos.map((p) => `
        <article class="pedido">
          <div class="pedido-cabeza">
            <b>#${p.numero}</b>
            <span class="tarjeta-detalle">${new Date(p.creado).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</span>
          </div>
          <div class="pedido-cabeza">
            <span>${esc(p.cliente || "Sin nombre")} · ${p.unidades} u.</span>
            <span class="precio">${pesos(p.total)}</span>
          </div>
          <ul class="pedido-items">${(p.items || []).map((it) =>
            `<li>${it.cantidad} × ${esc(it.nombre)}${it.ml ? " " + esc(it.ml) + " ml" : ""} — ${pesos(it.subtotal)}${it.en_oferta ? " (oferta)" : ""}</li>`).join("")}</ul>
          ${p.nota ? `<p class="tarjeta-detalle">Nota: ${esc(p.nota)}</p>` : ""}
          <label class="campo" for="estado-${p.numero}"><span>Estado</span>
            <select id="estado-${p.numero}" data-numero="${p.numero}">${ESTADOS.map(([k, t]) => `<option value="${k}" ${k === p.estado ? "selected" : ""}>${t}</option>`).join("")}</select>
          </label>
        </article>`).join("")
      : `<div class="panel-caja"><h2>Sin pedidos todavía</h2><p>Cuando un cliente envíe su pedido por WhatsApp desde la tienda, aparece acá con su número, productos y total.</p></div>`}`;
    c.querySelectorAll("select[data-numero]").forEach((s) => s.addEventListener("change", async () => {
      try { await api(`pedidos?numero=eq.${s.dataset.numero}`, { method: "PATCH", body: JSON.stringify({ estado: s.value }) }); toast(`Pedido #${s.dataset.numero}: ${s.options[s.selectedIndex].text}`); }
      catch (e) { toast("No se pudo cambiar el estado"); }
    }));
  }

  /* ---------- PRODUCTOS ---------- */
  let filtroProd = "todos", textoProd = "";
  const FILTROS = [["todos", "Todos"], ["oferta", "En oferta"], ["sinprecio", "Sin precio"], ["ocultos", "Ocultos"], ["agotados", "Sin stock"]];

  async function verProductos(c) {
    c.innerHTML = `
      <div class="panel-caja">
        <label class="campo" for="prod-buscar"><span>Buscar</span><input id="prod-buscar" type="search" placeholder="Nombre o marca" value="${esc(textoProd)}"></label>
        <div class="chips">${FILTROS.map(([k, t]) => `<button class="chip" data-filtro="${k}" aria-selected="${k === filtroProd}">${t}</button>`).join("")}</div>
      </div>
      <div id="prod-editor"></div>
      <div id="prod-lista"><p class="aviso-chico">Cargando…</p></div>`;
    let t;
    $("#prod-buscar").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { textoProd = e.target.value; listarProductos(); }, 250); });
    c.querySelectorAll("[data-filtro]").forEach((b) => b.addEventListener("click", () => {
      filtroProd = b.dataset.filtro;
      c.querySelectorAll("[data-filtro]").forEach((x) => x.setAttribute("aria-selected", x === b));
      listarProductos();
    }));
    await listarProductos();
  }

  async function listarProductos() {
    const caja = $("#prod-lista");
    let ruta = "productos?select=codigo,nombre,marca,categoria,foto,precio_publico,precio_oferta,visible,agotado,oferta_activa,precio_manual,margen,origen,oculto_por_sync&order=nombre&limit=60";
    const q = textoProd.trim().replace(/[,()*]/g, " ");
    if (q) ruta += `&or=(nombre.ilike.*${encodeURIComponent(q)}*,marca.ilike.*${encodeURIComponent(q)}*,codigo.ilike.*${encodeURIComponent(q)}*)`;
    if (filtroProd === "oferta") ruta += "&oferta_activa=eq.true";
    if (filtroProd === "sinprecio") ruta += "&precio_publico=is.null";
    if (filtroProd === "ocultos") ruta += "&visible=eq.false";
    if (filtroProd === "agotados") ruta += "&agotado=eq.true";
    const lista = await api(ruta);
    caja.innerHTML = lista.length ? lista.map((p) => `
      <button class="prod-fila" data-editar="${esc(p.codigo)}">
        ${p.foto ? `<img src="${esc(T().fotoUrl(p.foto))}" alt="" loading="lazy">` : "<span></span>"}
        <span>
          <span class="tarjeta-marca">${esc(p.marca || p.categoria || "")}</span><br>
          <span class="tarjeta-nombre">${esc(p.nombre)}</span>
          <span class="marcas">
            ${!p.visible ? `<span class="mini">${p.oculto_por_sync ? "ASHIBAH ya no lo tiene" : "Oculto"}</span>` : ""}
            ${p.origen === "propio" ? '<span class="mini">Propio</span>' : ""}
            ${p.agotado ? '<span class="mini">Sin stock</span>' : ""}
            ${p.oferta_activa ? '<span class="mini negro">Oferta</span>' : ""}
            ${p.precio_manual != null ? '<span class="mini">Precio fijo</span>' : ""}
            ${p.margen != null ? `<span class="mini">Margen ${p.margen}%</span>` : ""}
          </span>
        </span>
        <span class="precio">${p.precio_publico == null ? "<small>Sin precio</small>" : pesos(p.precio_oferta ?? p.precio_publico)}</span>
      </button>`).join("") + (lista.length === 60 ? `<p class="aviso-chico" style="padding-top:12px">Se muestran los primeros 60. Buscá por nombre o marca para encontrar otros.</p>` : "")
      : `<div class="panel-caja"><h2>Sin resultados</h2><p>Probá con otra búsqueda o cambiá el filtro.</p></div>`;
    caja.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => editarProducto(b.dataset.editar)));
  }

  async function editarProducto(codigo) {
    const ed = $("#prod-editor");
    ed.innerHTML = `<p class="aviso-chico">Abriendo…</p>`;
    const [p] = await api(`productos?select=*&codigo=eq.${encodeURIComponent(codigo)}`);
    const [costo] = await api(`costos?select=*&codigo=eq.${encodeURIComponent(codigo)}`);
    const tallas = costo && costo.costo_tallas ? Object.keys(costo.costo_tallas).sort((a, b) => a - b) : [];
    const hasta = p.oferta_hasta ? p.oferta_hasta.slice(0, 10) : "";
    ed.innerHTML = `
      <form class="panel-caja" id="form-prod">
        <div class="pedido-cabeza"><h2>${esc(p.nombre)}</h2><button type="button" class="cerrar" id="cerrar-editor">Cerrar</button></div>
        <p>${esc([p.marca, p.categoria, p.codigo].filter(Boolean).join(" · "))}</p>
        <div class="resumen-num">
          <div><span>Precio al público</span><b>${p.precio_publico == null ? "—" : pesos(p.precio_publico)}</b></div>
          ${p.precio_oferta != null ? `<div><span>Con oferta</span><b>${pesos(p.precio_oferta)}</b></div>` : ""}
          ${p.precios_tallas ? `<div><span>Por tamaño</span><b style="font-size:15px">${Object.entries(p.precios_tallas).map(([k, v]) => `${k} ml ${pesos(v)}`).join("<br>")}</b></div>` : ""}
        </div>
        <div class="fila-campos">
          ${tallas.length
            ? tallas.map((ml) => `<label class="campo" for="costo-${ml}"><span>Costo ${esc(ml)} ml</span><input id="costo-${ml}" data-talla="${esc(ml)}" type="number" inputmode="numeric" min="0" step="100" value="${costo.costo_tallas[ml] ?? ""}"></label>`).join("")
            : `<label class="campo" for="costo"><span>Costo</span><input id="costo" type="number" inputmode="numeric" min="0" step="100" value="${costo && costo.costo != null ? costo.costo : ""}"></label>`}
          <label class="campo" for="margen"><span>Margen propio %</span><input id="margen" type="number" inputmode="decimal" min="0" step="1" placeholder="General" value="${p.margen ?? ""}"></label>
          <label class="campo" for="precio-fijo"><span>Precio fijo</span><input id="precio-fijo" type="number" inputmode="numeric" min="0" step="100" placeholder="Usa la fórmula" value="${p.precio_manual ?? ""}"></label>
        </div>
        ${p.origen === "ashibah" ? `<label class="interruptor" for="costo-auto"><span>Actualizar el costo solo, todos los días, desde ASHIBAH</span><input id="costo-auto" type="checkbox" ${costo && costo.fijado_a_mano ? "" : "checked"}></label>` : ""}
        <p>Vacío = se usa la fórmula. Si cargás un precio fijo, manda sobre el cálculo.${p.origen === "ashibah" ? " Si cambiás el costo a mano, deja de actualizarse solo." : ""}</p>
        <label class="interruptor" for="visible"><span>Se ve en la tienda</span><input id="visible" type="checkbox" ${p.visible ? "checked" : ""}></label>
        <label class="interruptor" for="agotado"><span>Sin stock</span><input id="agotado" type="checkbox" ${p.agotado ? "checked" : ""}></label>
        <label class="interruptor" for="oferta"><span>Oferta activa</span><input id="oferta" type="checkbox" ${p.oferta_activa ? "checked" : ""}></label>
        <div class="fila-campos">
          <label class="campo" for="oferta-pct"><span>Descuento %</span><input id="oferta-pct" type="number" inputmode="numeric" min="1" max="90" step="1" value="${p.oferta_porcentaje ?? ""}"></label>
          <label class="campo" for="oferta-hasta"><span>Hasta (opcional)</span><input id="oferta-hasta" type="date" value="${hasta}"></label>
        </div>
        <button class="boton boton-ancho" type="submit">Guardar cambios</button>
        <p class="aviso-chico" role="status"></p>
      </form>`;
    ed.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#cerrar-editor").addEventListener("click", () => { ed.innerHTML = ""; });
    // si tocás el costo, queda fijado a mano
    ed.querySelectorAll("#costo, [data-talla]").forEach((i) => i.addEventListener("input", () => { const a = $("#costo-auto"); if (a) a.checked = false; }));
    $("#form-prod").addEventListener("submit", async (e) => {
      e.preventDefault();
      const aviso = e.target.querySelector(".aviso-chico");
      const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
      const ofertaOn = $("#oferta").checked, pct = num("#oferta-pct");
      if (ofertaOn && !(pct > 0 && pct < 100)) { aviso.textContent = "Para activar la oferta, poné un descuento entre 1 y 99%."; return; }
      aviso.textContent = "Guardando…";
      try {
        // costo (privado)
        let filaCosto;
        if (tallas.length) {
          const ct = {}; e.target.querySelectorAll("[data-talla]").forEach((i) => { ct[i.dataset.talla] = i.value === "" ? null : Number(i.value); });
          filaCosto = { codigo, costo: null, costo_tallas: ct, fijado_a_mano: !!$("#costo-auto") && !$("#costo-auto").checked };
        } else {
          filaCosto = { codigo, costo: num("#costo"), costo_tallas: null, fijado_a_mano: !!$("#costo-auto") && !$("#costo-auto").checked };
        }
        if (filaCosto.costo != null || filaCosto.costo_tallas) {
          await api("costos?on_conflict=codigo", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(filaCosto) });
        } else if (costo) {
          await api(`costos?codigo=eq.${encodeURIComponent(codigo)}`, { method: "DELETE" });
        }
        const hastaVal = $("#oferta-hasta").value;
        await api(`productos?codigo=eq.${encodeURIComponent(codigo)}`, { method: "PATCH", body: JSON.stringify({
          margen: num("#margen"), precio_manual: num("#precio-fijo"),
          visible: $("#visible").checked, oculto_por_sync: false, agotado: $("#agotado").checked,
          oferta_activa: ofertaOn, oferta_porcentaje: pct,
          oferta_hasta: hastaVal ? new Date(hastaVal + "T23:59:59-03:00").toISOString() : null
        }) });
        toast("Producto guardado");
        await editarProducto(codigo);
        listarProductos();
        T().recargar();
      } catch (err) { aviso.textContent = "No se pudo guardar: " + err.message; }
    });
  }

  /* ---------- FÓRMULA ---------- */
  async function verFormula(c) {
    const [cfg] = await api("config_precios?select=*&id=eq.1");
    const margenes = await api("margenes_categoria?select=*");
    const cats = [];
    for (let desde = 0; ; desde += 1000) {
      const lote = await api(`productos?select=categoria&order=codigo&limit=1000&offset=${desde}`);
      cats.push(...lote.map((x) => x.categoria));
      if (lote.length < 1000) break;
    }
    const unicas = [...new Set(cats.filter(Boolean))].sort();
    const mc = Object.fromEntries(margenes.map((m) => [m.categoria, m.margen]));
    const ej = Math.ceil(30000 * (1 + cfg.margen_general / 100) / cfg.redondeo) * cfg.redondeo;
    c.innerHTML = `
      <form class="panel-caja" id="form-formula">
        <h2>Fórmula de precios</h2>
        <p>Precio al público = costo + margen, redondeado siempre para arriba. Si cambiás algo, se recalculan todos los precios al instante.</p>
        <div class="fila-campos">
          <label class="campo" for="margen-general"><span>Margen general %</span><input id="margen-general" type="number" inputmode="decimal" min="0" step="1" value="${cfg.margen_general}"></label>
          <label class="campo" for="redondeo"><span>Redondear a</span>
            <select id="redondeo">${[100, 500, 1000, 5000].map((r) => `<option value="${r}" ${r === cfg.redondeo ? "selected" : ""}>${pesos(r)}</option>`).join("")}</select></label>
        </div>
        <p>Ejemplo: costo $30.000 → <b style="color:var(--tinta)">${pesos(ej)}</b></p>
        <h2 style="margin-top:8px">Por categoría</h2>
        <p>Vacío = usa el margen general.</p>
        <div class="fila-campos">${unicas.map((cat, i) => `
          <label class="campo" for="mc-${i}"><span>${esc(cat)}</span><input id="mc-${i}" data-cat="${esc(cat)}" type="number" inputmode="decimal" min="0" step="1" placeholder="${cfg.margen_general}" value="${mc[cat] ?? ""}"></label>`).join("")}
        </div>
        <button class="boton boton-ancho" type="submit">Guardar y recalcular</button>
        <p class="aviso-chico" role="status"></p>
      </form>`;
    $("#form-formula").addEventListener("submit", async (e) => {
      e.preventDefault();
      const aviso = e.target.querySelector(".aviso-chico");
      const mg = Number($("#margen-general").value);
      if (!(mg >= 0)) { aviso.textContent = "Poné un margen general válido."; return; }
      aviso.textContent = "Recalculando precios…";
      try {
        const poner = [], sacar = [];
        e.target.querySelectorAll("[data-cat]").forEach((i) => {
          if (i.value.trim() === "") { if (mc[i.dataset.cat] != null) sacar.push(i.dataset.cat); }
          else if (Number(i.value) !== Number(mc[i.dataset.cat])) poner.push({ categoria: i.dataset.cat, margen: Number(i.value) });
        });
        if (poner.length) await api("margenes_categoria?on_conflict=categoria", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(poner) });
        for (const cat of sacar) await api(`margenes_categoria?categoria=eq.${encodeURIComponent(cat)}`, { method: "DELETE" });
        await api("config_precios?id=eq.1", { method: "PATCH", body: JSON.stringify({ margen_general: mg, redondeo: Number($("#redondeo").value) }) });
        toast("Precios recalculados");
        T().recargar();
        verFormula(c);
      } catch (err) { aviso.textContent = "No se pudo guardar: " + err.message; }
    });
  }

  /* ---------- AJUSTES ---------- */
  async function verAjustes(c) {
    const aj = await api("ajustes?select=*");
    const wa = (aj.find((a) => a.clave === "whatsapp") || {}).valor || "";
    c.innerHTML = `
      <form class="panel-caja" id="form-ajustes">
        <h2>WhatsApp de pedidos</h2>
        <p>A este número llegan los pedidos. Con código de país y sin el 15. Ejemplo: 5492954123456.</p>
        <label class="campo" for="wa"><span>Número</span><input id="wa" type="tel" inputmode="numeric" value="${esc(wa)}" placeholder="549…"></label>
        <button class="boton boton-ancho" type="submit">Guardar</button>
        <p class="aviso-chico" role="status">${wa ? `Los pedidos salen a +${esc(wa)}.` : "Todavía no hay número: la tienda no puede enviar pedidos."}</p>
      </form>
      <div class="panel-caja" id="caja-sync">
        <h2>Actualización desde ASHIBAH</h2>
        <p>Todos los días, a las 6:47, se traen los costos y productos de ASHIBAH: tus precios se recalculan, los productos nuevos se publican y los que ellos ya no tienen se ocultan. Lo que cargues vos y los costos fijados a mano no se tocan.</p>
        <div id="sync-estado"><p class="aviso-chico">Cargando…</p></div>
        <button class="boton boton-borde boton-ancho" type="button" id="sync-ahora">Actualizar ahora</button>
        <p class="aviso-chico" id="sync-aviso" role="status"></p>
      </div>`;
    pintarSync();
    $("#sync-ahora").addEventListener("click", sincronizarAhora);
    $("#form-ajustes").addEventListener("submit", async (e) => {
      e.preventDefault();
      const n = $("#wa").value.replace(/\D/g, "");
      const aviso = e.target.querySelector(".aviso-chico");
      if (n.length < 10) { aviso.textContent = "El número parece incompleto. Revisalo con código de país."; return; }
      try {
        await api("ajustes?clave=eq.whatsapp", { method: "PATCH", body: JSON.stringify({ valor: n, actualizado: new Date().toISOString() }) });
        toast("WhatsApp guardado"); T().recargar(); verAjustes(c);
      } catch (err) { aviso.textContent = "No se pudo guardar: " + err.message; }
    });
  }

  /* ---------- SINCRONIZACIÓN ---------- */
  function textoSync(x) {
    if (!x) return "Todavía no se hizo ninguna actualización.";
    const cuando = new Date(x.fin || x.inicio).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
    if (x.estado === "enviado") return `En curso desde ${cuando}.`;
    if (x.estado === "error") return `La última (${cuando}) no se pudo completar: ${x.detalle || "error"}. Se vuelve a intentar mañana, o tocá "Actualizar ahora".`;
    const partes = [];
    partes.push(x.costos_cambiados ? `${x.costos_cambiados} costos actualizados` : "sin cambios de costos");
    if (x.nuevos) partes.push(`${x.nuevos} productos nuevos`);
    if (x.ocultados) partes.push(`${x.ocultados} ocultados porque ASHIBAH ya no los tiene`);
    if (x.reaparecidos) partes.push(`${x.reaparecidos} volvieron`);
    return `Última: ${cuando} · ${partes.join(" · ")}.`;
  }

  async function pintarSync() {
    const caja = $("#sync-estado"); if (!caja) return;
    try {
      const [x] = await api("sincronizaciones?select=*&order=id.desc&limit=1");
      caja.innerHTML = `<p style="color:var(--texto)">${esc(textoSync(x))}</p>`;
    } catch (e) { caja.innerHTML = `<p>No se pudo leer el estado.</p>`; }
  }

  async function sincronizarAhora() {
    const btn = $("#sync-ahora"), aviso = $("#sync-aviso");
    btn.disabled = true; aviso.textContent = "Pidiendo la lista a ASHIBAH…";
    try {
      await api("rpc/pedir_sync", { method: "POST", body: "{}" });
      let res = null;
      for (let intento = 0; intento < 12; intento++) {
        await new Promise((r) => setTimeout(r, 5000));
        aviso.textContent = "Procesando productos y costos…";
        res = await api("rpc/procesar_sync", { method: "POST", body: "{}" });
        if (res && res.estado !== "esperando") break;
      }
      if (res && res.estado === "ok") {
        aviso.textContent = "Listo. Los precios ya están actualizados.";
        toast("Actualizado desde ASHIBAH");
        T().recargar();
      } else if (res && res.estado === "esperando") {
        aviso.textContent = "ASHIBAH está tardando en responder. Se termina sola en unos minutos.";
      } else {
        aviso.textContent = "No se pudo completar. Probá de nuevo en un rato.";
      }
    } catch (e) {
      aviso.textContent = "No se pudo actualizar: " + e.message;
    } finally {
      btn.disabled = false; pintarSync();
    }
  }

  window.BS_PANEL = { mostrar };
  if (location.hash === "#panel") mostrar();
})();
