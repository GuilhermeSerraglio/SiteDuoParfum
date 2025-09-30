const https = require("https");

const { getFirebaseAdmin } = require("./_firebase-admin");

function sanitizeCode(code = "") {
  return code.toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sanitizeOrderId(value = "") {
  return value.toString().trim();
}

function fetchCorreiosTracking(code) {
  const url = `https://proxyapp.correios.com.br/v1/sro-rastro/${encodeURIComponent(code)}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        let data = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (err) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              return reject(new Error("Resposta inválida dos Correios"));
            }
            data = {};
          }
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data?.mensagem || data?.message || `Correios HTTP ${res.statusCode}`;
          const error = new Error(message);
          error.status = res.statusCode;
          error.details = data;
          return reject(error);
        }

        resolve(data || {});
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Tempo excedido na consulta aos Correios"));
    });
  });
}

function normalizeLocation(unidade = {}, destino = {}) {
  const parts = [];
  const origemParts = [];
  if (unidade.local) origemParts.push(unidade.local);
  const origemCidade = [unidade.cidade, unidade.uf].filter(Boolean).join(" - ");
  if (origemCidade) origemParts.push(origemCidade);
  if (origemParts.length) parts.push(origemParts.join(" • "));

  const destinoParts = [];
  if (destino.local) destinoParts.push(destino.local);
  const destinoCidade = [destino.cidade, destino.uf].filter(Boolean).join(" - ");
  if (destinoCidade) destinoParts.push(destinoCidade);
  if (destinoParts.length) {
    const destinoText = destinoParts.join(" • ");
    if (parts.length) {
      parts.push(`Destino: ${destinoText}`);
    } else {
      parts.push(destinoText);
    }
  }

  return parts.join(" · ");
}

function toIsoString(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function normalizeEvent(event = {}) {
  const description = event.descricao || event.description || "";
  const status = event.status || description;
  const details = event.detalhe || event.detalhes || event.details || "";
  const timestamp = toIsoString(event.dtHrCriado || event.dataHora || event.horario);
  let date = event.data || "";
  let time = event.hora || "";
  if ((!date || !time) && timestamp) {
    const dt = new Date(timestamp);
    if (!Number.isNaN(dt.getTime())) {
      if (!date) date = dt.toISOString().slice(0, 10);
      if (!time) time = dt.toISOString().slice(11, 16);
    }
  }
  const location = normalizeLocation(event.unidade || {}, event.unidadeDestino || {});

  return {
    code: event.codigo || event.cod || "",
    status: status || "",
    description: description || "",
    details: details || "",
    date,
    time,
    timestamp,
    location,
    raw: event,
  };
}

function normalizeCorreiosData(code, payload = {}) {
  const objetos = Array.isArray(payload.objetos) ? payload.objetos : [];
  const normalizedCode = sanitizeCode(code);
  const objeto =
    objetos.find((item) => sanitizeCode(item?.codObjeto) === normalizedCode) || objetos[0] || {};
  const events = Array.isArray(objeto.eventos) ? objeto.eventos.map(normalizeEvent) : [];
  const filteredEvents = events.filter(Boolean);
  filteredEvents.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA;
  });

  return {
    code: sanitizeCode(objeto.codObjeto || normalizedCode),
    events: filteredEvents,
    raw: objeto,
  };
}

function sanitizeOrderStatus(status = "") {
  const normalized = status.toString().toLowerCase();
  if (["pending", "paid", "sent", "delivered", "canceled"].includes(normalized)) {
    return normalized;
  }
  return "pending";
}

function determineShippingStatus(events = []) {
  if (!Array.isArray(events) || !events.length) {
    return null;
  }

  const texts = events.map((event) => {
    const status = (event.status || event.description || "").toLowerCase();
    const details = (event.details || "").toLowerCase();
    return `${status} ${details}`.trim();
  });

  if (texts.some((text) => text.includes("entregue"))) {
    return "delivered";
  }
  if (texts.some((text) => text.includes("saiu para entrega"))) {
    return "out_for_delivery";
  }
  if (texts.some((text) => text.includes("aguardando retirada"))) {
    return "awaiting_pickup";
  }
  if (
    texts.some((text) =>
      text.includes("em trânsito") ||
      text.includes("em transito") ||
      text.includes("objeto postado") ||
      text.includes("objeto recebido") ||
      text.includes("encaminhado") ||
      text.includes("postado")
    )
  ) {
    return "in_transit";
  }
  return "label_generated";
}

function toFirestoreTimestamp(admin, isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return admin.firestore.Timestamp.fromDate(date);
}

async function updateTrackingInFirestore({ code, normalized, orderId }) {
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.warn("Firebase Admin não disponível para atualizar rastreio", err);
    return;
  }

  const db = admin.firestore();
  let docRef = null;
  let snapshot = null;

  if (orderId) {
    docRef = db.collection("orders").doc(orderId);
    snapshot = await docRef.get();
  }

  if (!snapshot || !snapshot.exists) {
    const byTracking = await db.collection("orders").where("trackingCode", "==", code).limit(1).get();
    if (!byTracking.empty) {
      docRef = byTracking.docs[0].ref;
      snapshot = byTracking.docs[0];
    }
  }

  if (!snapshot || !snapshot.exists) {
    const byShippingTracking = await db
      .collection("orders")
      .where("shipping.trackingCode", "==", code)
      .limit(1)
      .get();
    if (!byShippingTracking.empty) {
      docRef = byShippingTracking.docs[0].ref;
      snapshot = byShippingTracking.docs[0];
    }
  }

  if (!snapshot || !snapshot.exists) {
    console.warn("Pedido não encontrado para sincronizar rastreio", { code, orderId });
    return;
  }

  const data = snapshot.data() || {};
  const shippingData = typeof data.shipping === "object" && data.shipping ? { ...data.shipping } : {};
  const events = Array.isArray(normalized.events) ? normalized.events : [];
  const history = events.slice(0, 20).map((event) => {
    const { raw, ...rest } = event || {};
    return rest;
  });
  const latest = history[0] || null;
  const shippingStatus = determineShippingStatus(events) || shippingData.trackingStatus || shippingData.status || "";

  const shippingUpdate = {
    ...shippingData,
    trackingCode: code,
    trackingHistory: history,
    lastTrackingEvent: latest,
    trackingStatus,
    status: shippingStatus,
    trackingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (latest?.timestamp) {
    const ts = toFirestoreTimestamp(admin, latest.timestamp);
    if (ts) {
      shippingUpdate.lastTrackingEventTimestamp = ts;
    }
  }

  const updatePayload = {
    trackingCode: code,
    shipping: shippingUpdate,
  };

  const currentStatus = sanitizeOrderStatus(data.status);
  if (shippingStatus === "delivered") {
    updatePayload.status = "delivered";
    if (!data.deliveredAt) {
      updatePayload.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
    }
  } else if (["pending", "paid"].includes(currentStatus) && shippingStatus) {
    updatePayload.status = "sent";
  }

  try {
    await docRef.set(updatePayload, { merge: true });
  } catch (err) {
    console.error("Falha ao atualizar pedido com dados de rastreio:", err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const queryCode = Array.isArray(req.query?.code) ? req.query.code[0] : req.query?.code;
  const bodyCode = Array.isArray(req.body?.code) ? req.body.code[0] : req.body?.code;
  const code = sanitizeCode(queryCode || bodyCode || "");
  const queryOrderId = Array.isArray(req.query?.orderId) ? req.query.orderId[0] : req.query?.orderId;
  const bodyOrderId = Array.isArray(req.body?.orderId) ? req.body.orderId[0] : req.body?.orderId;
  const orderId = sanitizeOrderId(queryOrderId || bodyOrderId || "");

  if (!code) {
    return res.status(400).json({ error: "Código de rastreio inválido" });
  }

  try {
    const raw = await fetchCorreiosTracking(code);
    const result = normalizeCorreiosData(code, raw);
    updateTrackingInFirestore({ code: result.code, normalized: result, orderId }).catch((err) => {
      console.warn("Falha ao sincronizar rastreio no Firestore:", err);
    });
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(result);
  } catch (err) {
    console.error("Erro ao consultar rastreio dos Correios:", err);
    const message = err?.message || "Falha ao consultar os Correios";
    return res.status(502).json({ error: message });
  }
};
