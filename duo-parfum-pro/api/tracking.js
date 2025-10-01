/**
 * Endpoint de rastreio.
 *
 * Variáveis obrigatórias:
 * - MELHOR_ENVIO_ENV, MELHOR_ENVIO_CLIENT_ID, MELHOR_ENVIO_CLIENT_SECRET
 * - MELHOR_ENVIO_SERVICE_PAC, MELHOR_ENVIO_SERVICE_SEDEX
 * - MELHOR_ENVIO_USER_AGENT (opcional, mas recomendado)
 * - Dados do remetente (MELHOR_ENVIO_FROM_* ou MELHOR_ENVIO_SENDER_JSON)
 * - Credenciais Firebase Admin (FIREBASE_SERVICE_ACCOUNT ou equivalentes)
 */
const https = require("https");

function getFetch() {
  if (typeof fetch === "function") {
    return fetch.bind(globalThis);
  }
  // eslint-disable-next-line global-require
  const fetchModule = require("node-fetch");
  return (fetchModule && fetchModule.default) || fetchModule;
}

const fetchFn = getFetch();

const { getAccessToken } = require("./melhorenvio-auth");
const { getFirebaseAdmin } = require("./_firebase-admin");

function sanitizeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function sanitizeCode(code = "") {
  return code.toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sanitizeOrderId(value = "") {
  return value.toString().trim();
}

function resolveApiBase() {
  const explicit = sanitizeString(process.env.MELHOR_ENVIO_API_URL);
  if (explicit) return explicit;

  const env = sanitizeString(process.env.MELHOR_ENVIO_ENV || process.env.MELHOR_ENVIO_MODE).toLowerCase();
  if (env === "production" || env === "prod") {
    return "https://www.melhorenvio.com.br/api/v2";
  }

  return "https://sandbox.melhorenvio.com.br/api/v2";
}

function buildMelhorEnvioConfig() {
  return {
    baseUrl: resolveApiBase(),
    userAgent: sanitizeString(process.env.MELHOR_ENVIO_USER_AGENT || "SiteDuoParfum/1.0"),
  };
}

async function melhorEnvioRequest(config, path, { method = "GET", body } = {}) {
  let token;
  try {
    token = await getAccessToken();
  } catch (authError) {
    console.error("Falha ao autenticar no Melhor Envio:", authError);
    const error = new Error("Falha ao autenticar no Melhor Envio");
    error.status = 500;
    error.cause = authError;
    throw error;
  }

  const url = `${config.baseUrl}${path}`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": config.userAgent,
  };

  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetchFn(url, { method, headers, body: payload });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.warn("Resposta não JSON do Melhor Envio em", path, err);
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Melhor Envio HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
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

async function findOrderContext({ code, orderId }) {
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.warn("Firebase Admin não disponível para localizar pedido", err);
    return { admin: null, db: null, docRef: null, snapshot: null };
  }

  const db = admin.firestore();
  const normalizedCode = sanitizeCode(code || "");
  let docRef = null;
  let snapshot = null;

  if (orderId) {
    docRef = db.collection("orders").doc(orderId);
    snapshot = await docRef.get();
  }

  if ((!snapshot || !snapshot.exists) && normalizedCode) {
    const byTracking = await db.collection("orders").where("trackingCode", "==", normalizedCode).limit(1).get();
    if (!byTracking.empty) {
      docRef = byTracking.docs[0].ref;
      snapshot = byTracking.docs[0];
    }
  }

  if ((!snapshot || !snapshot.exists) && normalizedCode) {
    const byShippingTracking = await db
      .collection("orders")
      .where("shipping.trackingCode", "==", normalizedCode)
      .limit(1)
      .get();
    if (!byShippingTracking.empty) {
      docRef = byShippingTracking.docs[0].ref;
      snapshot = byShippingTracking.docs[0];
    }
  }

  if (!snapshot || !snapshot.exists) {
    return { admin, db, docRef: null, snapshot: null };
  }

  return { admin, db, docRef, snapshot };
}

function normalizeMelhorEnvioEvent(event = {}) {
  if (!event || typeof event !== "object") return null;

  const description =
    sanitizeString(event.description || event.message || event.label || event.title || event.status_description || "") ||
    "";
  const status = sanitizeString(event.status || event.state || event.category || description);
  const details =
    sanitizeString(
      event.details ||
        event.detail ||
        event.observation ||
        event.observations ||
        event.comment ||
        event.comments ||
        event.info ||
        ""
    ) || "";

  let timestampValue =
    event.created_at ||
    event.createdAt ||
    event.created_at_iso ||
    event.datetime ||
    event.dateTime ||
    event.updated_at ||
    event.timestamp ||
    null;

  let date = sanitizeString(event.date || "");
  let time = sanitizeString(event.time || "");

  if (!timestampValue && date) {
    timestampValue = `${date}${time ? `T${time}` : ""}`;
  }

  let timestamp = "";
  if (timestampValue) {
    const normalizedTimestamp =
      typeof timestampValue === "string" && timestampValue.includes(" ")
        ? timestampValue.replace(" ", "T")
        : timestampValue;
    timestamp = toIsoString(normalizedTimestamp);
    if (!timestamp) {
      timestamp = toIsoString(timestampValue);
    }
  }

  if ((!date || !time) && timestamp) {
    const dt = new Date(timestamp);
    if (!Number.isNaN(dt.getTime())) {
      if (!date) date = dt.toISOString().slice(0, 10);
      if (!time) time = dt.toISOString().slice(11, 16);
    }
  }

  const locationParts = [];
  const locationText = sanitizeString(event.location || event.local || event.place || "");
  if (locationText) locationParts.push(locationText);
  const cityState = [sanitizeString(event.city || ""), sanitizeString(event.state || event.state_abbr || "")]
    .filter(Boolean)
    .join(" - ");
  if (cityState) locationParts.push(cityState);
  const country = sanitizeString(event.country || "");
  if (country) locationParts.push(country);
  const location = locationParts.filter(Boolean).join(" · ");

  return {
    code: sanitizeString(event.code || event.tracking_code || event.tag || ""),
    status: status || description,
    description,
    details,
    date,
    time,
    timestamp,
    location,
    raw: event,
  };
}

function normalizeMelhorEnvioData(code, payload = {}) {
  if (!payload || typeof payload !== "object") {
    return {
      code: sanitizeCode(code),
      events: [],
      raw: payload,
    };
  }

  const normalizedCode = sanitizeCode(
    payload?.tracking?.code ||
      payload?.tracking_code ||
      payload?.trackingCode ||
      payload?.code ||
      payload?.id ||
      code
  );

  const rawEvents = [];
  if (Array.isArray(payload?.tracking?.events)) rawEvents.push(...payload.tracking.events);
  if (Array.isArray(payload?.events)) rawEvents.push(...payload.events);
  if (Array.isArray(payload?.history)) rawEvents.push(...payload.history);
  if (Array.isArray(payload?.tracking_history)) rawEvents.push(...payload.tracking_history);
  if (Array.isArray(payload?.trackingHistory)) rawEvents.push(...payload.trackingHistory);

  const events = rawEvents.map(normalizeMelhorEnvioEvent).filter(Boolean);
  events.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA;
  });

  return {
    code: normalizedCode || sanitizeCode(code),
    events,
    raw: payload,
  };
}

async function fetchMelhorEnvioTracking({ context, code }) {
  if (!context || !context.admin || !context.snapshot || !context.snapshot.exists) {
    return null;
  }

  const data = context.snapshot.data() || {};
  const shipping = typeof data.shipping === "object" && data.shipping ? { ...data.shipping } : {};
  const labelId = sanitizeString(
    shipping.labelId ||
      shipping.melhorEnvioOrderId ||
      shipping.orderId ||
      shipping.label_id ||
      data.labelId ||
      data.melhorEnvioOrderId ||
      ""
  );

  if (!labelId) {
    return null;
  }

  const config = buildMelhorEnvioConfig();
  const orderInfo = await melhorEnvioRequest(config, `/me/orders/${encodeURIComponent(labelId)}`, {
    method: "GET",
  });

  if (!orderInfo) {
    return null;
  }

  const normalized = normalizeMelhorEnvioData(code || shipping.trackingCode || "", orderInfo);
  if (!normalized.code) {
    normalized.code = sanitizeCode(code || shipping.trackingCode || shipping.tracking_code || "");
  }

  return { normalized, raw: orderInfo };
}

async function updateTrackingInFirestore({ code, normalized, orderId, context }) {
  let ctx = context;
  if (!ctx || !ctx.admin) {
    ctx = await findOrderContext({ code, orderId });
  }

  const { admin, docRef } = ctx || {};
  if (!admin) {
    console.warn("Firebase Admin não disponível para atualizar rastreio");
    return;
  }

  if (!docRef) {
    console.warn("Pedido não encontrado para sincronizar rastreio", { code, orderId });
    return;
  }

  let snapshot = ctx.snapshot;
  if (!snapshot || !snapshot.exists) {
    snapshot = await docRef.get();
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
    const context = await findOrderContext({ code, orderId });
    let melhorEnvioResult = null;
    let melhorEnvioError = null;

    if (context && context.admin && context.snapshot && context.snapshot.exists) {
      try {
        const melhorEnvioData = await fetchMelhorEnvioTracking({ context, code });
        if (melhorEnvioData?.normalized) {
          melhorEnvioResult = melhorEnvioData.normalized;
        }
      } catch (err) {
        console.error("Erro ao consultar rastreio no Melhor Envio:", err);
        melhorEnvioError = err;
      }
    }

    let result = melhorEnvioResult;
    const hasValidMelhorEnvioEvents =
      result && Array.isArray(result.events) && result.events.length > 0;

    if (!hasValidMelhorEnvioEvents) {
      const raw = await fetchCorreiosTracking(code);
      result = normalizeCorreiosData(code, raw);
      if (!result.provider) {
        result.provider = "correios";
      }
    } else {
      result.provider = "melhorenvio";
    }

    updateTrackingInFirestore({ code: result.code, normalized: result, orderId, context }).catch((err) => {
      console.warn("Falha ao sincronizar rastreio no Firestore:", err);
    });

    if (melhorEnvioError && !hasValidMelhorEnvioEvents) {
      result.melhorEnvioError = {
        message: melhorEnvioError.message || "Falha ao consultar o Melhor Envio",
        code: melhorEnvioError.code || melhorEnvioError.status || null,
      };
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(result);
  } catch (err) {
    console.error("Erro ao consultar rastreio dos Correios:", err);
    const message = err?.message || "Falha ao consultar os Correios";
    return res.status(502).json({ error: message });
  }
};
