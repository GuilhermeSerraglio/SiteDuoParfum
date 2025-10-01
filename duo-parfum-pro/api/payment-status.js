const MP_API_BASE = "https://api.mercadopago.com";

const { getFirebaseAdmin } = require("./_firebase-admin");
const { createLabelForOrder } = require("./create-label");

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      console.error("⚠️ Falha ao interpretar payload de notificação:", err);
      return {};
    }
  }
  return body;
}

function extractPaymentId(req, body) {
  const query = req.query || {};

  const candidates = [
    query.id,
    query["data.id"],
    query.data_id,
    body?.data?.id,
    body?.id,
  ].filter(Boolean);

  if (candidates.length) {
    const value = String(candidates[0]).trim();
    if (value) return value;
  }

  if (body?.resource && typeof body.resource === "string") {
    const match = body.resource.match(/(\d+)(?:\?.*)?$/);
    if (match) return match[1];
  }

  return null;
}

async function fetchPayment(paymentId, token) {
  const url = `${MP_API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error("⚠️ Resposta não JSON do Mercado Pago:", err);
    }
  }

  if (!response.ok) {
    const error = new Error(
      (data && (data.message || data.error)) || `Mercado Pago HTTP ${response.status}`
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data || {};
}

function extractOrderId(payment) {
  return (
    payment?.external_reference ||
    payment?.metadata?.orderId ||
    payment?.metadata?.order_id ||
    ""
  ).toString().trim();
}

function mapPaymentStatus(status) {
  const normalized = (status || "").toString().toLowerCase();
  if (normalized === "approved") return "paid";
  if (normalized === "authorized") return "paid";
  if (["pending", "in_process", "in_mediation"].includes(normalized)) {
    return "pending";
  }
  if (["rejected", "cancelled", "refunded", "charged_back"].includes(normalized)) {
    return "canceled";
  }
  return "pending";
}

function shouldUpdateStatus(currentStatus, nextStatus) {
  const current = (currentStatus || "").toString().toLowerCase();
  const next = (nextStatus || "").toString().toLowerCase();

  if (!next) return false;
  if (!current) return true;
  if (current === next) return true;

  if (next === "pending") {
    return current === "pending";
  }

  if (next === "paid") {
    return current === "pending" || current === "paid";
  }

  if (next === "canceled") {
    return current === "pending" || current === "paid";
  }

  return false;
}

function toTimestamp(admin, value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return admin.firestore.Timestamp.fromDate(date);
}

function cleanObject(source = {}) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined)
  );
}

function sanitizeTrackingCode(code = "") {
  return code.toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function buildPaymentData(admin, payment) {
  const amount = Number(payment?.transaction_amount);
  const installments = Number(payment?.installments);

  return cleanObject({
    id: payment?.id ? String(payment.id) : undefined,
    status: payment?.status,
    statusDetail: payment?.status_detail,
    method: payment?.payment_method_id,
    type: payment?.payment_type_id,
    transactionAmount: Number.isFinite(amount) ? amount : undefined,
    installments: Number.isFinite(installments) ? installments : undefined,
    payerEmail: payment?.payer?.email,
    approvedAt: toTimestamp(admin, payment?.date_approved),
    createdAt: toTimestamp(admin, payment?.date_created),
    lastUpdatedAt: toTimestamp(admin, payment?.date_last_updated),
    notificationReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    console.error("⚠️ MP_ACCESS_TOKEN não configurado");
    return res.status(500).json({ error: "Configuração de pagamento ausente" });
  }

  const body = req.method === "POST" ? parseBody(req.body) : {};
  const paymentId = extractPaymentId(req, body);

  if (!paymentId) {
    console.warn("⚠️ Notificação de pagamento sem identificador", {
      query: req.query,
      body,
    });
    return res.status(200).json({ received: true, ignored: true });
  }

  let payment;
  try {
    payment = await fetchPayment(paymentId, token);
  } catch (err) {
    console.error("❌ Falha ao consultar pagamento no Mercado Pago:", err);
    return res.status(200).json({ received: true, error: "payment_fetch_failed" });
  }

  const orderId = extractOrderId(payment);
  if (!orderId) {
    console.warn("⚠️ Pagamento sem referência de pedido", paymentId);
    return res.status(200).json({ received: true, orderFound: false });
  }

  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("❌ Erro ao inicializar Firebase Admin:", err);
    return res.status(500).json({ error: "Configuração do servidor indisponível" });
  }

  const db = admin.firestore();
  const orderRef = db.collection("orders").doc(orderId);
  const snapshot = await orderRef.get();

  if (!snapshot.exists) {
    console.warn("⚠️ Pedido não encontrado para atualizar status de pagamento:", orderId);
    return res.status(200).json({ received: true, orderFound: false });
  }

  const data = snapshot.data() || {};
  const currentStatus = (data?.status || "").toString().toLowerCase();
  const nextStatus = mapPaymentStatus(payment?.status);

  const update = {
    payment: buildPaymentData(admin, payment),
  };

  const shippingData =
    typeof data?.shipping === "object" && data.shipping ? { ...data.shipping } : {};
  const shippingMethod = (shippingData?.method || data?.customer?.shippingMethod || "")
    .toString()
    .toLowerCase();
  const existingTracking = sanitizeTrackingCode(
    data?.trackingCode || shippingData?.trackingCode || ""
  );

  if (shouldUpdateStatus(currentStatus, nextStatus)) {
    update.status = nextStatus;

    if (nextStatus === "paid") {
      const approvedAt = toTimestamp(admin, payment?.date_approved);
      if (approvedAt) {
        update.paidAt = approvedAt;
      }

      if (shippingMethod === "correios") {
        const nextShippingStatus = existingTracking
          ? shippingData?.trackingStatus || shippingData?.status || "label_generated"
          : "awaiting_label";
        update.shipping = {
          ...shippingData,
          method: shippingData?.method || "correios",
          service: shippingData?.service || "Correios",
          trackingStatus: nextShippingStatus,
          status: nextShippingStatus,
        };
      }
    }

    if (nextStatus === "canceled") {
      update.canceledAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }

  try {
    await orderRef.set(update, { merge: true });
  } catch (err) {
    console.error("❌ Falha ao atualizar pedido com status de pagamento:", err);
    return res.status(500).json({ error: "Erro ao atualizar pedido" });
  }

  if (nextStatus === "paid" && shippingMethod === "correios" && !existingTracking) {
    const labelServiceCode =
      shippingData?.serviceCode || shippingData?.selectedServiceCode || shippingData?.preferredServiceCode || "";
    try {
      const labelResult = await createLabelForOrder({
        orderId,
        serviceCode: labelServiceCode,
        auto: true,
      });
      if (labelResult?.trackingCode) {
        console.log("🚚 Etiqueta gerada automaticamente", {
          orderId,
          trackingCode: labelResult.trackingCode,
        });
      }
    } catch (err) {
      console.error("⚠️ Falha ao gerar etiqueta automaticamente:", err);
    }
  }

  console.log("✅ Status de pagamento sincronizado", {
    orderId,
    currentStatus,
    appliedStatus: update.status || currentStatus,
  });

  return res.status(200).json({ received: true, orderId, status: update.status || currentStatus });
};
