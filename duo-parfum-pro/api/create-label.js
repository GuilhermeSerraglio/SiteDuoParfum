/**
 * Endpoint de geração de etiqueta de postagem (Melhor Envio).
 *
 * Variáveis de ambiente necessárias:
 * - MELHOR_ENVIO_ENV
 * - MELHOR_ENVIO_CLIENT_ID / MELHOR_ENVIO_CLIENT_SECRET
 * - MELHOR_ENVIO_SERVICE_PAC / MELHOR_ENVIO_SERVICE_SEDEX
 * - MELHOR_ENVIO_USER_AGENT e dados de remetente (MELHOR_ENVIO_FROM_* ou MELHOR_ENVIO_SENDER_JSON)
 * - Credenciais do Firebase Admin (FIREBASE_SERVICE_ACCOUNT ou equivalentes)
 */
const { getFirebaseAdmin } = require("./_firebase-admin");
const { getAccessToken } = require("./melhorenvio-auth");

const ORIGIN = {
  city: "Sorriso",
  state: "MT",
  cep: "78890000",
  country: "BR",
};

const PRODUCT_DEFAULTS = {
  weightKg: 0.3,
  height: 2,
  width: 11,
  length: 16,
};

function getFetch() {
  if (typeof fetch === "function") {
    return fetch.bind(globalThis);
  }
  // eslint-disable-next-line global-require
  const fetchModule = require("node-fetch");
  return (fetchModule && fetchModule.default) || fetchModule;
}

const fetchFn = getFetch();

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

function sanitizeString(value, fallback = "") {
  if (!value && value !== 0) return fallback;
  return String(value).trim();
}

function sanitizeCep(value = "") {
  return value.toString().replace(/\D/g, "").slice(0, 8);
}

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function loadSenderConfig() {
  const rawJson = sanitizeString(
    process.env.MELHOR_ENVIO_SENDER_JSON ||
      process.env.MELHOR_ENVIO_FROM_JSON ||
      process.env.MELHOR_ENVIO_SENDER ||
      ""
  );
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (err) {
      console.warn("MELHOR_ENVIO_SENDER_JSON inválido:", err);
    }
  }

  return {
    name: sanitizeString(process.env.MELHOR_ENVIO_FROM_NAME || "Duo Parfum"),
    phone: sanitizeString(process.env.MELHOR_ENVIO_FROM_PHONE),
    email: sanitizeString(process.env.MELHOR_ENVIO_FROM_EMAIL || process.env.SUPPORT_EMAIL || ""),
    document: sanitizeString(process.env.MELHOR_ENVIO_FROM_DOCUMENT || process.env.MELHOR_ENVIO_DOCUMENT),
    postal_code: sanitizeCep(process.env.MELHOR_ENVIO_FROM_CEP || ORIGIN.cep),
    address: sanitizeString(process.env.MELHOR_ENVIO_FROM_ADDRESS),
    number: sanitizeString(process.env.MELHOR_ENVIO_FROM_NUMBER),
    complement: sanitizeString(process.env.MELHOR_ENVIO_FROM_COMPLEMENT),
    district: sanitizeString(process.env.MELHOR_ENVIO_FROM_DISTRICT),
    city: sanitizeString(process.env.MELHOR_ENVIO_FROM_CITY || ORIGIN.city),
    state_abbr: sanitizeString(process.env.MELHOR_ENVIO_FROM_STATE || ORIGIN.state),
    country: sanitizeString(process.env.MELHOR_ENVIO_FROM_COUNTRY || ORIGIN.country || "BR"),
  };
}

function buildMelhorEnvioConfig() {
  return {
    baseUrl: resolveApiBase(),
    userAgent: sanitizeString(process.env.MELHOR_ENVIO_USER_AGENT || "SiteDuoParfum/1.0"),
    agency: sanitizeString(process.env.MELHOR_ENVIO_AGENCY_ID),
    sender: loadSenderConfig(),
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

  const response = await fetchFn(url, {
    method,
    headers,
    body: payload,
  });

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

function resolveServiceId(serviceCode) {
  const normalized = sanitizeString(serviceCode);
  if (!normalized) return null;
  const envDirect = sanitizeString(process.env[`MELHOR_ENVIO_SERVICE_${normalized}`]);
  if (envDirect) return envDirect;
  if (normalized === "04014") {
    return (
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_SEDEX) ||
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_SEDEX_ID) ||
      null
    );
  }
  if (normalized === "04510") {
    return (
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_PAC) ||
      sanitizeString(process.env.MELHOR_ENVIO_SERVICE_PAC_ID) ||
      null
    );
  }
  return null;
}

function buildVolumeFromPackage(pkg = {}) {
  const dimensions = pkg?.dimensions || {};
  const weight = sanitizeNumber(pkg?.billedWeightKg || pkg?.weightKg, PRODUCT_DEFAULTS.weightKg);
  return {
    height: Math.max(PRODUCT_DEFAULTS.height, sanitizeNumber(dimensions.altura, PRODUCT_DEFAULTS.height)),
    width: Math.max(PRODUCT_DEFAULTS.width, sanitizeNumber(dimensions.largura, PRODUCT_DEFAULTS.width)),
    length: Math.max(PRODUCT_DEFAULTS.length, sanitizeNumber(dimensions.comprimento, PRODUCT_DEFAULTS.length)),
    weight: Number(Math.max(PRODUCT_DEFAULTS.weightKg, weight).toFixed(3)),
  };
}

function buildProducts(items = []) {
  return items.map((item) => ({
    name: sanitizeString(item?.name || "Decant"),
    quantity: Math.max(1, sanitizeNumber(item?.qty, 1)),
    unitary_value: Number((sanitizeNumber(item?.price, 0) || 0).toFixed(2)),
  }));
}

function extractTrackingCode(info = {}) {
  if (!info) return "";
  if (info.tracking) {
    if (typeof info.tracking === "string") return sanitizeString(info.tracking);
    if (typeof info.tracking === "object") {
      return sanitizeString(info.tracking.code || info.tracking.number || "");
    }
  }
  if (Array.isArray(info.tags)) {
    const trackingTag = info.tags.find((tag) => /[A-Z]{2}\d{9}[A-Z]{2}/i.test(tag));
    if (trackingTag) return sanitizeString(trackingTag);
  }
  return sanitizeString(info.tracking_code || info.code || info.id || "");
}

function extractLabelUrl(info = {}) {
  if (!info) return "";
  if (info.label_url) return sanitizeString(info.label_url);
  if (info.url) return sanitizeString(info.url);
  if (info.link) return sanitizeString(info.link);
  if (Array.isArray(info.labels) && info.labels.length) {
    const first = info.labels[0];
    if (first) {
      return sanitizeString(first.url || first.link || "");
    }
  }
  return "";
}

function sanitizeOrderStatus(status = "") {
  const normalized = status.toString().toLowerCase();
  if (["delivered", "canceled", "sent", "paid", "pending"].includes(normalized)) {
    return normalized;
  }
  return "pending";
}

async function createLabelForOrder({ orderId, serviceCode, force = false, auto = false }) {
  if (!orderId) {
    const error = new Error("Pedido não informado para geração da etiqueta");
    error.status = 400;
    throw error;
  }

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const orderRef = db.collection("orders").doc(orderId);
  const snapshot = await orderRef.get();
  if (!snapshot.exists) {
    const error = new Error("Pedido não encontrado");
    error.status = 404;
    throw error;
  }

  const data = snapshot.data() || {};
  const shippingData = typeof data.shipping === "object" && data.shipping ? { ...data.shipping } : {};
  const shippingMethod = sanitizeString(shippingData.method || data?.customer?.shippingMethod || "correios").toLowerCase();

  if (shippingMethod !== "correios") {
    const error = new Error("A geração de etiqueta está disponível apenas para envios pelos Correios");
    error.status = 400;
    throw error;
  }

  const existingTracking = sanitizeString(data.trackingCode || shippingData.trackingCode || "");
  const existingLabelUrl = sanitizeString(shippingData.labelUrl || "");
  if (existingTracking && existingLabelUrl && !force) {
    return {
      orderId,
      generated: false,
      skipped: true,
      reason: "label_already_exists",
      trackingCode: existingTracking,
      labelUrl: existingLabelUrl,
    };
  }

  const selectedServiceCode = sanitizeString(
    serviceCode || shippingData.serviceCode || shippingData.selectedServiceCode || shippingData.preferredServiceCode || ""
  );
  const melhorEnvioServiceId = resolveServiceId(selectedServiceCode);
  if (!melhorEnvioServiceId) {
    const error = new Error(
      `Serviço do Melhor Envio não configurado para o código dos Correios ${selectedServiceCode || "(desconhecido)"}.`
    );
    error.status = 400;
    throw error;
  }

  const config = buildMelhorEnvioConfig();
  const sender = config.sender || {};

  const shippingPackage = shippingData.package || {};
  const volume = buildVolumeFromPackage(shippingPackage);
  const products = buildProducts(data.items || []);
  const subtotal = sanitizeNumber(data.subtotal, 0);
  const insuranceValue = shippingPackage.declaredValue || subtotal || sanitizeNumber(data.total, 0);

  const destinationCep = sanitizeCep(shippingData.cep || data.customer?.cep || "");
  if (!destinationCep) {
    const error = new Error("CEP de destino não informado para o pedido");
    error.status = 400;
    throw error;
  }

  const shipmentPayload = {
    service: melhorEnvioServiceId,
    agency: config.agency || undefined,
    from: {
      name: sender.name || "Duo Parfum",
      phone: sender.phone || "",
      email: sender.email || data.customer?.email || "",
      document: sender.document || "",
      postal_code: sanitizeCep(sender.postal_code || ORIGIN.cep),
      address: sender.address || "",
      number: sender.number || "",
      complement: sender.complement || "",
      district: sender.district || "",
      city: sender.city || ORIGIN.city,
      state_abbr: sender.state_abbr || ORIGIN.state,
      country: sender.country || ORIGIN.country || "BR",
    },
    to: {
      name: sanitizeString(data.customer?.name || shippingData.recipient || "Cliente Duo Parfum"),
      phone: sanitizeString(data.customer?.phone || ""),
      email: sanitizeString(data.customer?.email || ""),
      document: sanitizeString(data.customer?.document || ""),
      postal_code: destinationCep,
      address: sanitizeString(data.customer?.address || shippingData.address || ""),
      number: sanitizeString(data.customer?.number || shippingData.number || ""),
      complement: sanitizeString(data.customer?.complement || shippingData.complement || ""),
      district: sanitizeString(data.customer?.district || ""),
      city: sanitizeString(data.customer?.city || ORIGIN.city),
      state_abbr: sanitizeString(data.customer?.state || ORIGIN.state),
      country: "BR",
    },
    products,
    volumes: [volume],
    options: {
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: true,
      collect: false,
    },
    insurance_value: Number(Math.max(0, insuranceValue).toFixed(2)),
  };

  const cartResult = await melhorEnvioRequest(config, "/me/cart", {
    method: "POST",
    body: [shipmentPayload],
  });

  const cartArray = Array.isArray(cartResult) ? cartResult : cartResult?.data || [];
  const orderIds = cartArray
    .map((item) => sanitizeString(item?.id))
    .filter((id) => id);

  if (!orderIds.length) {
    const error = new Error("Não foi possível adicionar o envio ao carrinho do Melhor Envio");
    error.status = 502;
    throw error;
  }

  await melhorEnvioRequest(config, "/me/shipment/checkout", {
    method: "POST",
    body: {
      orders: orderIds,
      wallet: false,
    },
  });

  await melhorEnvioRequest(config, "/me/shipment/generate", {
    method: "POST",
    body: { orders: orderIds },
  });

  const orderInfo = await melhorEnvioRequest(config, `/me/orders/${orderIds[0]}`, {
    method: "GET",
  });

  const trackingCode = extractTrackingCode(orderInfo);
  const labelUrl = extractLabelUrl(orderInfo);
  const labelId = sanitizeString(orderInfo?.id || orderIds[0]);

  if (!trackingCode) {
    console.warn("Etiqueta gerada mas código de rastreio não retornado", {
      orderId,
      orderIds,
      response: orderInfo,
    });
  }

  const shippingStatus = trackingCode ? "label_generated" : shippingData.trackingStatus || "awaiting_label";
  const updatePayload = {
    trackingCode,
    shipping: {
      ...shippingData,
      provider: "melhorenvio",
      method: "melhorenvio",
      trackingCode,
      labelUrl,
      labelId,
      trackingGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      trackingGeneratedBy: auto ? "automatic" : "manual",
      trackingStatus: shippingStatus,
      status: shippingStatus,
    },
  };

  if (!trackingCode) {
    updatePayload.shipping.trackingStatus = shippingStatus;
  }

  const currentStatus = sanitizeOrderStatus(data.status);
  if (shippingStatus === "delivered") {
    updatePayload.status = "delivered";
  } else if (["pending", "paid", "sent"].includes(currentStatus)) {
    updatePayload.status = "sent";
  }

  await orderRef.set(updatePayload, { merge: true });

  return {
    orderId,
    generated: true,
    trackingCode,
    labelUrl,
    labelId,
    shippingStatus,
  };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const payload = parseBody(req.body);
  const orderId = sanitizeString(payload.orderId || payload.id);
  const serviceCode = sanitizeString(payload.serviceCode || "");
  const force = Boolean(payload.force);

  try {
    const result = await createLabelForOrder({ orderId, serviceCode, force });
    return res.status(result.generated ? 201 : 200).json(result);
  } catch (err) {
    console.error("Erro ao gerar etiqueta:", err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Falha ao gerar etiqueta" });
  }
}

module.exports = handler;
module.exports.createLabelForOrder = createLabelForOrder;
