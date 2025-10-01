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
const { getAccessToken } = require("./melhorenvio-auth");
const { getFirebaseAdmin } = require("./_firebase-admin");

// ---------------- Utils ----------------
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
function toIsoString(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}
function sanitizeOrderStatus(status = "") {
  const normalized = status.toString().toLowerCase();
  if (["pending", "paid", "sent", "delivered", "canceled"].includes(normalized)) {
    return normalized;
  }
  return "pending";
}

// ---------------- Correios tracking ----------------
function fetchCorreiosTracking(code) {
  const url = `https://proxyapp.correios.com.br/v1/sro-rastro/${encodeURIComponent(code)}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let data = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              return reject(new Error("Resposta inválida dos Correios"));
            }
          }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data?.mensagem || data?.message || `Correios HTTP ${res.statusCode}`;
          const error = new Error(message);
          error.status = res.statusCode;
          return reject(error);
        }
        resolve(data || {});
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Tempo excedido na consulta aos Correios"));
    });
  });
}

function normalizeLocation(unidade = {}, destino = {}) {
  const parts = [];
  const origem = [unidade.local, [unidade.cidade, unidade.uf].filter(Boolean).join(" - ")].filter(Boolean).join(" • ");
  if (origem) parts.push(origem);
  const destinoText = [destino.local, [destino.cidade, destino.uf].filter(Boolean).join(" - ")].filter(Boolean).join(" • ");
  if (destinoText) parts.push(`Destino: ${destinoText}`);
  return parts.join(" · ");
}

function normalizeEvent(event = {}) {
  const description = event.descricao || event.description || "";
  const status = event.status || description;
  const details = event.detalhe || event.details || "";
  const timestamp = toIsoString(event.dtHrCriado || event.dataHora || event.horario);
  let date = event.data || "";
  let time = event.hora || "";
  if ((!date || !time) && timestamp) {
    const dt = new Date(timestamp);
    if (!date) date = dt.toISOString().slice(0, 10);
    if (!time) time = dt.toISOString().slice(11, 16);
  }
  return {
    code: event.codigo || "",
    status,
    description,
    details,
    date,
    time,
    timestamp,
    location: normalizeLocation(event.unidade || {}, event.unidadeDestino || {}),
    raw: event,
  };
}

function normalizeCorreiosData(code, payload = {}) {
  const objetos = Array.isArray(payload.objetos) ? payload.objetos : [];
  const objeto = objetos.find((item) => sanitizeCode(item?.codObjeto) === sanitizeCode(code)) || objetos[0] || {};
  const events = Array.isArray(objeto.eventos) ? objeto.eventos.map(normalizeEvent) : [];
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { code: sanitizeCode(objeto.codObjeto || code), events, raw: objeto, provider: "correios" };
}

// ---------------- Melhor Envio tracking ----------------
function resolveApiBase() {
  const explicit = sanitizeString(process.env.MELHOR_ENVIO_API_URL);
  if (explicit) return explicit;
  const env = sanitizeString(process.env.MELHOR_ENVIO_ENV || "").toLowerCase();
  return env === "production" ? "https://www.melhorenvio.com.br/api/v2" : "https://sandbox.melhorenvio.com.br/api/v2";
}

async function melhorEnvioRequest(path) {
  const token = await getAccessToken();
  const res = await fetch(`${resolveApiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "SiteDuoParfum/1.0" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Erro Melhor Envio ${res.status}`);
  return data;
}

function normalizeMelhorEnvioData(code, payload = {}) {
  const events = []
    .concat(payload?.tracking?.events || [], payload?.events || [], payload?.history || [])
    .map((e) => ({
      code: sanitizeString(e.code || ""),
      status: sanitizeString(e.status || e.description || ""),
      description: sanitizeString(e.description || ""),
      details: sanitizeString(e.details || ""),
      timestamp: toIsoString(e.created_at || e.updated_at),
      raw: e,
    }))
    .filter(Boolean);
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { code: sanitizeCode(code), events, raw: payload, provider: "melhorenvio" };
}

// ---------------- Firestore sync ----------------
async function updateTrackingInFirestore({ code, normalized, orderId }) {
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch {
    return;
  }
  const db = admin.firestore();
  let docRef = orderId ? db.collection("orders").doc(orderId) : null;
  let snapshot = docRef ? await docRef.get() : null;
  if (!snapshot || !snapshot.exists) {
    const byTracking = await db.collection("orders").where("trackingCode", "==", code).limit(1).get();
    if (!byTracking.empty) {
      docRef = byTracking.docs[0].ref;
      snapshot = byTracking.docs[0];
    }
  }
  if (!snapshot || !snapshot.exists) return;

  const data = snapshot.data() || {};
  const events = normalized.events || [];
  const latest = events[0] || null;
  const shippingStatus = latest?.status || "pending";
  const updatePayload = {
    trackingCode: code,
    shipping: {
      ...data.shipping,
      trackingCode: code,
      trackingHistory: events,
      lastTrackingEvent: latest,
      trackingStatus: shippingStatus,
      trackingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
  if (shippingStatus === "delivered") {
    updatePayload.status = "delivered";
    updatePayload.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
  } else if (["pending", "paid"].includes(data.status)) {
    updatePayload.status = "sent";
  }
  await docRef.set(updatePayload, { merge: true });
}

// ---------------- Handler ----------------
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const code = sanitizeCode(req.query?.code || req.body?.code || "");
  const orderId = sanitizeOrderId(req.query?.orderId || req.body?.orderId || "");
  if (!code) return res.status(400).json({ error: "Código de rastreio inválido" });

  try {
    let result;
    try {
      const orderInfo = await melhorEnvioRequest(`/me/tracking/${encodeURIComponent(code)}`);
      result = normalizeMelhorEnvioData(code, orderInfo);
    } catch (err) {
      console.warn("Erro Melhor Envio:", err.message);
      const raw = await fetchCorreiosTracking(code);
      result = normalizeCorreiosData(code, raw);
    }

    updateTrackingInFirestore({ code, normalized: result, orderId }).catch(console.error);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(result);
  } catch (err) {
    console.error("Erro ao consultar rastreio:", err);
    return res.status(502).json({ error: err.message || "Falha ao consultar rastreio" });
  }
};
