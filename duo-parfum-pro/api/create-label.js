/**
 * Endpoint de geração de rótulo de envio (Melhor Envio).
 *
 * Variáveis obrigatórias:
 * - MELHOR_ENVIO_ENV ("sandbox" ou "production")
 * - MELHOR_ENVIO_CLIENT_ID / MELHOR_ENVIO_CLIENT_SECRET
 * - MELHOR_ENVIO_USER_AGENT (ex.: "SiteDuoParfum/1.0")
 * - MELHOR_ENVIO_SERVICE_PAC / MELHOR_ENVIO_SERVICE_SEDEX
 * - Dados do remetente (MELHOR_ENVIO_FROM_* ou MELHOR_ENVIO_SENDER_JSON)
 * - Credenciais Firebase Admin (FIREBASE_SERVICE_ACCOUNT ou equivalentes)
 */

const { getAccessToken } = require("./melhorenvio-auth");
const { getFirebaseAdmin } = require("./_firebase-admin");

function sanitizeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}
function sanitizeCep(value = "") {
  return value.toString().replace(/\D/g, "").slice(0, 8);
}
function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveApiBase() {
  const explicit = sanitizeString(process.env.MELHOR_ENVIO_API_URL);
  if (explicit) return explicit;
  const env = sanitizeString(process.env.MELHOR_ENVIO_ENV || "").toLowerCase();
  return env === "production"
    ? "https://www.melhorenvio.com.br/api/v2"
    : "https://sandbox.melhorenvio.com.br/api/v2";
}

async function melhorEnvioRequest(path, { method = "POST", body } = {}) {
  const token = await getAccessToken();
  const url = `${resolveApiBase()}${path}`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": sanitizeString(process.env.MELHOR_ENVIO_USER_AGENT || "SiteDuoParfum/1.0"),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida do Melhor Envio: ${text}`);
  }
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Erro Melhor Envio ${res.status}`);
  }
  return data;
}

// ---------------- Handler ----------------
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { orderId, service, items, buyer } = req.body || {};
  if (!orderId || !Array.isArray(items) || !buyer?.cep) {
    return res.status(400).json({ error: "Dados inválidos: informe orderId, buyer.cep e items[]" });
  }

  try {
    // Monta produtos
    const products = items.map((i, idx) => ({
      name: sanitizeString(i?.name || `Produto ${idx + 1}`),
      quantity: Math.max(1, toNumber(i?.qty, 1)),
      unitary_value: toNumber(i?.price, 0),
    }));

    // Monta volumes básicos (peso fictício de 0.3kg por item + margem)
    const billedWeight = Math.max(0.3, items.length * 0.2 + 0.1);
    const volumes = [
      {
        height: 2,
        width: 11,
        length: 16,
        weight: billedWeight,
      },
    ];

    // Monta objeto de envio Melhor Envio
    const shipment = {
      service: service || process.env.MELHOR_ENVIO_SERVICE_SEDEX, // default SEDEX
      from: {
        postal_code: sanitizeCep(process.env.MELHOR_ENVIO_FROM_CEP),
        country: "BR",
      },
      to: {
        postal_code: sanitizeCep(buyer.cep),
        country: "BR",
      },
      products,
      volumes,
      options: {
        receipt: false,
        own_hand: false,
        reverse: false,
        non_commercial: true,
        insurance_value: toNumber(items.reduce((s, i) => s + i.price * (i.qty || 1), 0), 0),
      },
    };

    // Cria ordem no Melhor Envio
    const created = await melhorEnvioRequest("/me/cart", { method: "POST", body: [shipment] });
    const checkout = await melhorEnvioRequest("/me/checkout", {
      method: "POST",
      body: { orders: created.map((c) => c.id) },
    });

    const label = checkout[0] || {};
    const trackingCode = label.tracking || label.tracking_code || null;
    const labelUrl = label.url || label.link || null;
    const labelId = label.id || null;

    // Atualiza Firestore
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const docRef = db.collection("orders").doc(orderId);
      await docRef.set(
        {
          labelId,
          trackingCode,
          labelUrl,
          shipping: {
            labelId,
            trackingCode,
            labelUrl,
            status: "label_generated",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("Não foi possível salvar no Firestore:", err.message);
    }

    return res.status(200).json({
      success: true,
      labelId,
      trackingCode,
      labelUrl,
    });
  } catch (err) {
    console.error("Erro ao gerar rótulo:", err);
    return res.status(502).json({ error: err.message || "Falha ao gerar rótulo" });
  }
};
