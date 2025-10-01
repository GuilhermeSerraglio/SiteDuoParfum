const { getFirebaseAdmin } = require("./_firebase-admin");

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

function sanitizeString(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return value.toString();
  }
  return "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const payload = parseBody(req.body);
  let debugPayload = payload;
  try {
    debugPayload = JSON.stringify(payload, null, 2);
  } catch (err) {
    // ignore json stringify errors and log original payload
  }
  console.log("Webhook do Melhor Envio recebido:", debugPayload);

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    const event = payload?.evento || payload?.event || payload || {};
    const resource = event?.resource || payload?.resource || {};
    const labelId = sanitizeString(resource?.id);
    const status = sanitizeString(resource?.status);

    if (!labelId) {
      throw new Error("ID da etiqueta não informado no webhook");
    }

    const orderRef = db.collection("pedidos").doc(labelId);
    await orderRef.set(
      {
        status,
        atualizadoEm: new Date(),
      },
      { merge: true }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erro ao processar webhook do Melhor Envio:", err);
    return res.status(500).json({ error: "Erro ao processar webhook" });
  }
};
