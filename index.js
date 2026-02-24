const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const app = express();
app.use(express.json());

// ============================================================
//  CONFIGURACIÓN - Edita estos valores con los tuyos
// ============================================================
const CONFIG = {
  // Meta / WhatsApp
  VERIFY_TOKEN: "maneki_store_2024",
  WHATSAPP_TOKEN: "EAANLqM41gEgBQZBN0nP9b5nZCx2ji9gJEJ9Nboe1EKNrWm2V7BgePbsmrTZCeH5GfQ00W6wLEC7fLaZC0GA5pIJKG7IRJ197VgttEt2jqdlhUUxvEEfqXQtfwCcLvOTfo9Uzt1RUcnLuZAzTcCMucHkvjnxFYBqvopalyDnASuDInX74t7poduBcbDcICYNZCbbBG7JqNOXoSWrexiWHA9r4EVJjnZCeLrM0BEwxHh4HTfVRKNcoGRM9GJZC1yKCMwqhEbRZBRZCc5XSq0QqsLVagMPZAfFFwpBeVyZACjVZCZAwZDZD",
  PHONE_NUMBER_ID: "1000545163142966",

  // Supabase - los encuentras en Settings > API dentro de tu proyecto
  SUPABASE_URL: "https://hoqcrljgmamaumtdrtzi.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcWNybGpnbWFtYXVtdGRydHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzOTAwOTgsImV4cCI6MjA4Njk2NjA5OH0.x_gYRz29tK7InMxQaDyZL2bdD1-hCCJ1qg6tgvmRO5o",

  // Negocio
  NOTIFY_NUMBERS: [
    "528124134065",
    "528136000138",
    "528130743002"
  ],
  FACEBOOK_PAGE: "https://www.facebook.com/share/1AnSmoH5Mc/",
  STORE_NAME: "Maneki Store 🐱",
  HORARIO: "Lun-Sáb 8am-10pm | Dom 8am-2pm"
};

// ============================================================
//  CLIENTE SUPABASE
// ============================================================
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ============================================================
//  SESIONES EN MEMORIA
// ============================================================
const sessions = {};

function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = { step: "menu", pedido: {}, visitas: 0 };
  }
  return sessions[phone];
}

function resetSession(phone) {
  const v = sessions[phone] ? sessions[phone].visitas + 1 : 1;
  sessions[phone] = { step: "menu", pedido: {}, visitas: v };
}

// ============================================================
//  HELPERS DE SUPABASE
// ============================================================

// Buscar o crear cliente en tabla clients
async function upsertCliente(nombre, telefono) {
  try {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("telefono", telefono)
      .single();

    if (existing) return existing.id;

    const { data: nuevo } = await supabase
      .from("clients")
      .insert({ nombre, telefono, redes: "WhatsApp" })
      .select("id")
      .single();

    return nuevo?.id || null;
  } catch {
    return null;
  }
}

// Obtener productos disponibles de Supabase
async function getProductos(category = null) {
  try {
    let query = supabase
      .from("products")
      .select("id, name, category, price, stock, variants, image_url")
      .gt("stock", 0);

    if (category) query = query.eq("category", category);

    const { data } = await query.order("name");
    return data || [];
  } catch {
    return [];
  }
}

// Obtener categorías únicas disponibles
async function getCategorias() {
  try {
    const { data } = await supabase
      .from("products")
      .select("category")
      .gt("stock", 0);

    if (!data) return [];
    const cats = [...new Set(data.map(p => p.category).filter(Boolean))];
    return cats;
  } catch {
    return [];
  }
}

// Crear pedido en Supabase
async function crearPedidoSupabase(pedido) {
  try {
    const fecha = new Date().toLocaleString("es-MX");
    const folio = `WA-${Date.now().toString().slice(-6)}`;

    const registro = {
      folio,
      cliente: pedido.nombre,
      telefono: pedido.clientePhone,
      redes: "WhatsApp",
      fecha,
      entrega: pedido.entrega,
      concepto: pedido.descripcion,
      cantidad: 1,
      costo: 0,
      anticipo: 0,
      total: 0,
      resta: 0,
      notas: pedido.fechaEspecial && pedido.fechaEspecial !== "no tengo fecha límite"
        ? `Fecha especial: ${pedido.fechaEspecial}. Foto: ${pedido.foto}`
        : `Foto: ${pedido.foto}`,
      status: "Confirmado",
      fecha_creacion: fecha,
      productos_inventario: pedido.productoObj
        ? [{ id: pedido.productoObj.id, name: pedido.productoObj.name, qty: 1, talla: pedido.talla || null, color: pedido.color || null, corte: pedido.corte || null }]
        : [{ name: pedido.producto, qty: 1 }]
    };

    if (pedido.direccion) registro.notas += ` | Dirección: ${pedido.direccion}`;

    const { data, error } = await supabase
      .from("pedidos")
      .insert(registro)
      .select("folio")
      .single();

    if (error) throw error;
    return data?.folio || folio;
  } catch (e) {
    console.error("Error creando pedido en Supabase:", e.message);
    return null;
  }
}

// Rastrear pedido por folio
async function rastrearPedidoSupabase(folio) {
  try {
    const { data } = await supabase
      .from("pedidos")
      .select("folio, cliente, concepto, status, fecha_creacion, entrega")
      .eq("folio", folio.toUpperCase())
      .single();

    return data || null;
  } catch {
    return null;
  }
}

// ============================================================
//  TEXTOS DEL BOT
// ============================================================
function esFueraDeHorario() {
  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours();
  if (dia === 0) return hora < 8 || hora >= 14;
  if (dia >= 1 && dia <= 6) return hora < 8 || hora >= 22;
  return false;
}

function mensajeBienvenida(esClienteFrecuente) {
  const aviso = esFueraDeHorario()
    ? `\n\n⏰ _Estamos fuera de horario (${CONFIG.HORARIO}) pero revisamos mensajes constantemente. ¡Te atendemos muy pronto!_`
    : "";

  const saludo = esClienteFrecuente
    ? `¡Qué gusto verte de nuevo! 🎉 Gracias por confiar otra vez en *${CONFIG.STORE_NAME}*`
    : `¡Hola! Bienvenido a *${CONFIG.STORE_NAME}* 🎁\nEspecialistas en regalos personalizados en Monterrey.`;

  return `${saludo}${aviso}

¿En qué te puedo ayudar hoy?

1️⃣ Ver catálogo de productos
2️⃣ Hacer un pedido
3️⃣ Ver precios
4️⃣ Rastrear mi pedido
5️⃣ Preguntas frecuentes
6️⃣ Hablar con un asesor

_Responde con el número de tu opción_ 👆`;
}

// Traduce status del POS a mensaje amigable para el cliente
function traducirStatus(status) {
  const map = {
    "Urgente":     "⚠️ Marcado como URGENTE — en atención prioritaria",
    "Confirmado":  "✅ Confirmado — pronto iniciamos producción",
    "Pago":        "💰 Pago registrado — listo para producción",
    "Producción":  "⚙️ En producción — estamos trabajando en tu pedido",
    "Envío":       "📦 Preparado para envío",
    "Salió":       "🚚 ¡Ya salió! En camino hacia ti",
    "Retirar":     "🏪 ¡Listo! Puedes pasar a recogerlo"
  };
  return map[status] || `📋 Estado: ${status}`;
}

const FAQ = `❓ *Preguntas Frecuentes - Maneki Store*

*¿Cuánto tarda mi pedido?*
⏱️ De 2 a 4 días hábiles tras confirmar y anticipo.

*¿Cómo envío mi foto o diseño?*
📸 Por WhatsApp o Messenger en la mejor calidad posible.

*¿Hacen envíos?*
🚚 Sí:
• *Área Metro Monterrey:* con costo según ubicación
• *República Mexicana:* DHL, FedEx, Redpack o J&T

*¿Cómo pago?*
💳 Efectivo, tarjeta o transferencia bancaria.

*¿Cuánto es el anticipo?*
💵 Del 20% al 40% según producto. El resto al recibir.

*¿Aceptan cambios o devoluciones?*
✅ Sin costo si el error es nuestro (texto, foto, daño).
❌ No aplica si la información del cliente fue correcta.

*¿Cuál es su horario?*
🕐 Lunes-Sábado: 8am - 10pm
🕐 Domingos: 8am - 2pm

Escribe *MENU* para volver al inicio.`;

// ============================================================
//  FLUJO DE PEDIDO
// ============================================================
async function procesarPedido(phone, session, mensaje) {
  const pedido = session.pedido;
  const step = session.step;

  // Seleccionar producto
  if (step === "pedido_producto") {
    const productos = await getProductos();
    const num = parseInt(mensaje.trim());
    if (isNaN(num) || num < 1 || num > productos.length) {
      return `Por favor responde con un número del 1 al ${productos.length} 👆`;
    }
    const prod = productos[num - 1];
    pedido.producto = prod.name;
    pedido.productoObj = prod;

    // Si tiene variantes (tallas/colores)
    if (prod.variants && Object.keys(prod.variants).length > 0) {
      const variants = prod.variants;
      session.step = "pedido_variante";
      session.variantKeys = Object.keys(variants);
      session.variantIdx = 0;
      const key = session.variantKeys[0];
      const opciones = variants[key];
      return `✅ Producto: *${prod.name}*\n\n¿Qué ${key} deseas?\n${Array.isArray(opciones) ? opciones.map((o, i) => `${i+1}. ${o}`).join("\n") : opciones}\n\n_Escribe tu opción:_`;
    }

    session.step = "pedido_descripcion";
    return `✅ Producto: *${prod.name}*${prod.price > 0 ? `\n💰 Precio: $${prod.price}` : ""}\n\nDescribe los detalles de tu pedido (diseño, texto, colores, etc.):\n\n_Escribe los detalles:_`;
  }

  // Variantes del producto
  if (step === "pedido_variante") {
    const prod = pedido.productoObj;
    const key = session.variantKeys[session.variantIdx];
    pedido[key] = mensaje.trim();
    session.variantIdx++;

    if (session.variantIdx < session.variantKeys.length) {
      const nextKey = session.variantKeys[session.variantIdx];
      const opciones = prod.variants[nextKey];
      return `¿Qué ${nextKey} deseas?\n${Array.isArray(opciones) ? opciones.map((o, i) => `${i+1}. ${o}`).join("\n") : opciones}\n\n_Escribe tu opción:_`;
    }

    session.step = "pedido_descripcion";
    return `Describe los detalles de tu pedido (diseño, texto, foto, etc.):\n\n_Escribe los detalles:_`;
  }

  // Descripción
  if (step === "pedido_descripcion") {
    pedido.descripcion = mensaje.trim();
    session.step = "pedido_nombre";
    return `📝 Anotado.\n\n¿Cuál es tu *nombre completo*?`;
  }

  // Nombre
  if (step === "pedido_nombre") {
    pedido.nombre = mensaje.trim();
    session.step = "pedido_entrega";
    return `Hola *${pedido.nombre}* 😊\n\n¿Cómo prefieres recibir tu pedido?\n\n1️⃣ Recoger en tienda\n2️⃣ Envío Área Metro Monterrey\n3️⃣ Envío foráneo (República Mexicana)`;
  }

  // Tipo de entrega
  if (step === "pedido_entrega") {
    const opciones = { "1": "Recoger en tienda", "2": "Envío Monterrey", "3": "Envío foráneo" };
    if (!opciones[mensaje.trim()]) return "Por favor responde 1, 2 o 3 👆";
    pedido.entrega = opciones[mensaje.trim()];
    if (mensaje.trim() === "1") {
      session.step = "pedido_fecha";
      return `¿Tienes alguna *fecha límite*? (cumpleaños, aniversario, etc.)\n\n_Escribe la fecha o "No tengo fecha límite":_`;
    } else {
      session.step = "pedido_direccion";
      return `¿Cuál es tu *dirección completa* de entrega?\n\n_Calle, número, colonia, ciudad:_`;
    }
  }

  // Dirección
  if (step === "pedido_direccion") {
    pedido.direccion = mensaje.trim();
    session.step = "pedido_fecha";
    return `¿Tienes alguna *fecha límite*? (cumpleaños, aniversario, etc.)\n\n_Escribe la fecha o "No tengo fecha límite":_`;
  }

  // Fecha especial
  if (step === "pedido_fecha") {
    pedido.fechaEspecial = mensaje.trim();
    session.step = "pedido_pago";
    return `¿Cómo prefieres pagar?\n\n1️⃣ Efectivo\n2️⃣ Tarjeta\n3️⃣ Transferencia bancaria`;
  }

  // Método de pago
  if (step === "pedido_pago") {
    const pagos = { "1": "Efectivo", "2": "Tarjeta", "3": "Transferencia" };
    if (!pagos[mensaje.trim()]) return "Por favor responde 1, 2 o 3 👆";
    pedido.pago = pagos[mensaje.trim()];
    session.step = "pedido_foto";
    return `📸 *Último paso:*\n\nEnvíame la foto o diseño por este chat.\n\n_Cuando la envíes confirmamos tu pedido_ ✅\n\n_(Si no la tienes lista escribe "DESPUÉS")_`;
  }

  // Foto y confirmación final
  if (step === "pedido_foto") {
    pedido.foto = mensaje.toLowerCase().includes("después") ? "Pendiente de envío" : "Recibida ✅";
    pedido.clientePhone = phone;

    // Guardar en Supabase
    const folio = await crearPedidoSupabase(pedido);

    if (!folio) {
      return `⚠️ Hubo un problema al registrar tu pedido. Por favor escribe *ASESOR* para que te ayudemos directamente.`;
    }

    // Aviso de fecha especial
    let avisoFecha = "";
    const fecha = pedido.fechaEspecial?.toLowerCase();
    if (fecha && fecha !== "no tengo fecha límite") {
      avisoFecha = `\n\n⚠️ *Nota:* Recuerda que tardamos 2-4 días hábiles. Si tu fecha está muy próxima, avísanos para priorizarlo.`;
    }

    // Resumen para el negocio
    const resumen = generarResumenNegocio(pedido, folio);
    await notificarNegocio(resumen);

    session.step = "menu";

    return `✅ *¡Pedido registrado, ${pedido.nombre}!*

📋 *Tu folio es: ${folio}*
_Guárdalo para rastrear tu pedido_

💵 *Anticipo requerido:* 20-40% del total
_(Te confirmamos el monto exacto en breve)_${avisoFecha}

*Resumen:*
• Producto: ${pedido.producto}
${pedido.talla ? `• Talla: ${pedido.talla}\n` : ""}${pedido.color ? `• Color: ${pedido.color}\n` : ""}${pedido.corte ? `• Corte: ${pedido.corte}\n` : ""}• Entrega: ${pedido.entrega}
• Pago: ${pedido.pago}

Nos contactamos contigo pronto para confirmar detalles. 🐱

Escribe *MENU* para volver al inicio.`;
  }

  return "No entendí eso. Escribe *MENU* para volver al inicio.";
}

function generarResumenNegocio(pedido, folio) {
  return `🐱 *NUEVO PEDIDO WhatsApp - MANEKI STORE*
━━━━━━━━━━━━━━━━━━━━
📋 *Folio:* ${folio}
📅 *Fecha:* ${new Date().toLocaleString("es-MX")}
━━━━━━━━━━━━━━━━━━━━
👤 *Cliente:* ${pedido.nombre}
📱 *Teléfono:* ${pedido.clientePhone}
━━━━━━━━━━━━━━━━━━━━
🛍️ *Producto:* ${pedido.producto}
${pedido.corte ? `✂️ Corte: ${pedido.corte}\n` : ""}${pedido.talla ? `📏 Talla: ${pedido.talla}\n` : ""}${pedido.color ? `🎨 Color: ${pedido.color}\n` : ""}📝 *Detalle:* ${pedido.descripcion}
━━━━━━━━━━━━━━━━━━━━
🚚 *Entrega:* ${pedido.entrega}
${pedido.direccion ? `📍 Dirección: ${pedido.direccion}\n` : ""}${pedido.fechaEspecial ? `📅 Fecha límite: ${pedido.fechaEspecial}\n` : ""}💳 *Pago:* ${pedido.pago}
📸 *Foto:* ${pedido.foto}
━━━━━━━━━━━━━━━━━━━━
✅ Registrado en Supabase automáticamente`;
}

// ============================================================
//  PROCESAR MENSAJE
// ============================================================
async function procesarMensaje(phone, mensaje) {
  const session = getSession(phone);
  const msg = mensaje.trim().toUpperCase();

  // Comandos globales
  const saludos = ["MENU", "INICIO", "HOLA", "HI", "BUENOS DIAS", "BUENAS TARDES", "BUENAS NOCHES", "BUENAS", "QUE TAL", "EY", "HELLO"];
  if (saludos.some(s => msg === s || msg.startsWith(s + " "))) {
    const esClienteFrecuente = session.visitas > 1;
    resetSession(phone);
    return mensajeBienvenida(esClienteFrecuente);
  }

  if (msg === "ASESOR") {
    await notificarNegocio(`🔔 *CLIENTE SOLICITA ASESOR*\n📱 ${phone}\n⏰ ${new Date().toLocaleString("es-MX")}`);
    session.step = "esperando_asesor";
    return `✅ ¡Listo! Ya notifiqué a nuestro equipo.\n\nUn asesor de *Maneki Store* te contactará pronto. 🐱\n\nEscribe *MENU* si deseas hacer algo más.`;
  }

  if (msg === "PEDIR") {
    session.step = "pedido_producto";
    return await mostrarProductosParaPedido();
  }

  // Flujo de pedido activo
  if (session.step.startsWith("pedido_") || session.step === "pedido_variante") {
    return await procesarPedido(phone, session, mensaje);
  }

  // Menú principal
  if (session.step === "menu") {
    switch (msg) {
      case "1":
        session.step = "catalogo";
        return await mostrarCatalogo();

      case "2":
        session.step = "pedido_producto";
        return await mostrarProductosParaPedido();

      case "3":
        return await mostrarPrecios();

      case "4":
        session.step = "rastreo";
        return `🔍 *Rastrear pedido*\n\n¿Cuál es tu número de folio?\n_(Ejemplo: WA-123456)_`;

      case "5":
        return FAQ;

      case "6":
        await notificarNegocio(`🔔 *CLIENTE SOLICITA ASESOR*\n📱 ${phone}\n⏰ ${new Date().toLocaleString("es-MX")}`);
        session.step = "esperando_asesor";
        return `✅ ¡Listo! Ya notifiqué a nuestro equipo.\n\nUn asesor te contactará pronto. 🐱\n\nEscribe *MENU* para volver al inicio.`;

      default:
        return mensajeBienvenida(session.visitas > 1);
    }
  }

  // Catálogo
  if (session.step === "catalogo") {
    if (msg === "0" || msg === "VOLVER") {
      resetSession(phone);
      return mensajeBienvenida(session.visitas > 1);
    }
    return await mostrarCatalogo();
  }

  // Rastreo
  if (session.step === "rastreo") {
    session.step = "menu";
    const pedido = await rastrearPedidoSupabase(mensaje.trim());
    if (!pedido) {
      return `❌ No encontré el folio *${mensaje.trim()}*.\n\nVerifica que sea correcto o escribe *ASESOR* para ayuda.\n\nEscribe *MENU* para volver al inicio.`;
    }
    return `📦 *Estado de tu pedido*

📋 *Folio:* ${pedido.folio}
👤 Cliente: ${pedido.cliente}
🛍️ Producto: ${pedido.concepto}
📅 Fecha: ${pedido.fecha_creacion}
🚚 Entrega: ${pedido.entrega}

*${traducirStatus(pedido.status)}*

Para más información escribe *ASESOR* o *MENU* para volver.`;
  }

  // Default
  resetSession(phone);
  return mensajeBienvenida(session.visitas > 1);
}

// ============================================================
//  CATÁLOGO DINÁMICO DESDE SUPABASE
// ============================================================
async function mostrarCatalogo() {
  const categorias = await getCategorias();

  if (categorias.length === 0) {
    return `🛍️ *Catálogo Maneki Store*\n\nPor favor escribe *ASESOR* para ver nuestros productos disponibles. 🐱\n\nEscribe *MENU* para volver.`;
  }

  let texto = `🛍️ *Catálogo Maneki Store*\n\n¿Qué categoría te interesa?\n\n`;
  categorias.forEach((cat, i) => {
    texto += `${i + 1}️⃣ ${cat}\n`;
  });
  texto += `\n0️⃣ Volver al menú\n\n_Responde con el número_ 👆`;
  return texto;
}

async function mostrarProductosParaPedido() {
  const productos = await getProductos();

  if (productos.length === 0) {
    return `😔 Por el momento no hay productos con stock disponible.\n\nEscribe *ASESOR* para consultar disponibilidad o *MENU* para volver.`;
  }

  let texto = `📝 *¿Qué producto deseas pedir?*\n\n`;
  productos.forEach((p, i) => {
    const precio = p.price > 0 ? ` - $${p.price}` : "";
    const stock = p.stock > 0 ? ` ✅` : ` ❌ Sin stock`;
    texto += `${i + 1}️⃣ ${p.name}${precio}${stock}\n`;
  });
  texto += `\n_Responde con el número_ 👆`;
  return texto;
}

async function mostrarPrecios() {
  const productos = await getProductos();

  if (productos.length === 0) {
    return `💰 *Precios Maneki Store*\n\nEscribe *ASESOR* para una cotización personalizada.\n\n📘 Ver trabajos: ${CONFIG.FACEBOOK_PAGE}\n\nEscribe *MENU* para volver.`;
  }

  let texto = `💰 *Lista de Precios - Maneki Store*\n\n`;
  const categorias = [...new Set(productos.map(p => p.category).filter(Boolean))];

  for (const cat of categorias) {
    texto += `*${cat}*\n`;
    productos.filter(p => p.category === cat).forEach(p => {
      if (p.price > 0) texto += `• ${p.name}: $${p.price}\n`;
    });
    texto += `\n`;
  }

  texto += `_Precios pueden variar según personalización._\n\nEscribe *PEDIR* para hacer un pedido o *MENU* para volver.`;
  return texto;
}

// ============================================================
//  NOTIFICAR AL NEGOCIO
// ============================================================
async function notificarNegocio(mensaje) {
  for (const numero of CONFIG.NOTIFY_NUMBERS) {
    try {
      await sendMessage(numero, mensaje);
    } catch (e) {
      console.error(`Error notificando ${numero}:`, e.message);
    }
  }
}

// ============================================================
//  ENVIAR MENSAJE WHATSAPP
// ============================================================
async function sendMessage(to, body) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${CONFIG.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ============================================================
//  WEBHOOKS
// ============================================================
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;

    const phone = message.from;
    let texto = "";

    if (message.type === "text") {
      texto = message.text.body;
    } else if (message.type === "image") {
      const session = getSession(phone);
      if (session.step === "pedido_foto") {
        const respuesta = await procesarPedido(phone, session, "foto recibida");
        await sendMessage(phone, respuesta);
      } else {
        await sendMessage(phone, `Vi tu imagen 📸 Escribe *MENU* para ver las opciones.`);
      }
      return;
    } else {
      return;
    }

    const respuesta = await procesarMensaje(phone, texto);
    await sendMessage(phone, respuesta);

  } catch (error) {
    console.error("Error:", error);
  }
});

app.get("/", (_, res) => res.send("🐱 Maneki Store Bot - Activo y conectado a Supabase"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🐱 Maneki Store Bot corriendo en puerto ${PORT}`));
