# BLACKSHEEP · Tienda web

Tienda de perfumes de **@_blacksheep.sr**. Los productos, precios y pedidos viven en Supabase (proyecto *BlackSheep*).

## Qué hay en cada archivo

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La estructura de la página: inicio, colección, Chopp, nosotros, carrito. |
| `estilos.css` | Todo el diseño (colores, letras, animaciones). |
| `app.js` | La tienda: trae los productos, filtros, carrito y pedido por WhatsApp. |
| `panel.js` | El panel de administración (entrás desde `tu-tienda/#panel`). |
| `config.js` | La dirección de tu base de Supabase y tu Instagram. |
| `assets/` | Logos, la oveja y Chopp. |

## Cómo se manejan las cosas

- **Precios**: se calculan solos con la fórmula (costo + margen, redondeado para arriba). Se cambia desde el panel → *Fórmula*.
- **Ofertas, stock, precio fijo, ocultar productos**: panel → *Productos*.
- **Pedidos**: llegan por WhatsApp y quedan guardados en panel → *Pedidos*.
- **Número de WhatsApp**: panel → *Ajustes*.
- **Actualización diaria desde ASHIBAH** (6:47, hora de Argentina): trae costos y productos; los precios se recalculan solos, los productos nuevos se publican y los que ASHIBAH ya no tiene se ocultan. Los productos propios y los costos fijados a mano no se tocan. Estado y botón *Actualizar ahora* en panel → *Ajustes*.

Los costos y márgenes nunca se ven en la tienda: solo los administradores pueden leerlos.
