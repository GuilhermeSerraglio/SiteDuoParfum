const admin = require("firebase-admin");

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "guilhermeserraglio03@gmail.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function normalizePrivateKey(key) {
  if (!key) return undefined;
  return key.replace(/\r/g, "").replace(/\\n/g, "\n");
}

function loadServiceAccountFromEnv() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.private_key && parsed.client_email && parsed.project_id) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: normalizePrivateKey(parsed.private_key),
        };
      }
    } catch (err) {
      console.error("FIREBASE_SERVICE_ACCOUNT inválido:", err);
    }
  }

  const base64Json =
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ||
    "";
  if (base64Json) {
    try {
      const decoded = Buffer.from(base64Json, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (parsed.private_key && parsed.client_email && parsed.project_id) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: normalizePrivateKey(parsed.private_key),
        };
      }
    } catch (err) {
      console.error("FIREBASE_SERVICE_ACCOUNT_BASE64 inválido:", err);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

function initializeFirebaseAdmin() {
  if (admin.apps.length) {
    return;
  }

  const credentials = loadServiceAccountFromEnv();

  if (!credentials) {
    throw new Error(
      "Credenciais do Firebase Admin não configuradas. Defina FIREBASE_SERVICE_ACCOUNT (JSON), FIREBASE_SERVICE_ACCOUNT_BASE64 ou as variáveis FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY."
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: credentials.projectId,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
    }),
  });
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      console.error("Falha ao interpretar corpo da requisição:", err);
      return {};
    }
  }
  return body;
}

async function authenticateRequest(req) {
  const authHeader = req.headers?.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    const error = new Error("Token de autenticação ausente");
    error.status = 401;
    throw error;
  }

  const token = match[1].trim();
  if (!token) {
    const error = new Error("Token de autenticação ausente");
    error.status = 401;
    throw error;
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (err) {
    console.error("Falha ao verificar token do Firebase:", err);
    const error = new Error("Token inválido ou expirado");
    error.status = 401;
    throw error;
  }

  const email = (decoded?.email || "").toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) {
    const error = new Error("Usuário não autorizado");
    error.status = 403;
    throw error;
  }

  return { email, uid: decoded.uid };
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = async function handler(req, res) {
  try {
    initializeFirebaseAdmin();
  } catch (err) {
    console.error("Erro ao inicializar Firebase Admin:", err);
    return res
      .status(500)
      .json({ error: "Configuração do servidor indisponível" });
  }

  if (!ADMIN_EMAILS.length) {
    console.warn("Nenhum e-mail de administrador configurado");
  }

  const db = admin.firestore();

  if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "POST, PATCH, DELETE");
    return res.status(405).json({ error: "Método não permitido" });
  }

  let user;
  try {
    user = await authenticateRequest(req);
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ error: err.message || "Não autorizado" });
  }

  const payload = parseBody(req.body);

  if (req.method === "POST") {
    const name = sanitizeString(payload.name);
    const brand = sanitizeString(payload.brand);
    const ml = sanitizeString(payload.ml);
    const notes = sanitizeString(payload.notes);
    const category = sanitizeString(payload.category);
    const image = sanitizeString(payload.image);
    const featured = Boolean(payload.featured);

    const priceValue = Number(payload.price);
    if (!name) {
      return res.status(400).json({ error: "Nome do produto é obrigatório" });
    }
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      return res.status(400).json({ error: "Preço inválido" });
    }

    const product = {
      name,
      brand,
      ml,
      price: Math.round(priceValue * 100) / 100,
      notes,
      category,
      image,
      stock: 0,
      featured,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: user.email,
    };

    try {
      const docRef = await db.collection("products").add(product);
      return res.status(201).json({ id: docRef.id });
    } catch (err) {
      console.error("Erro ao criar produto:", err);
      return res.status(500).json({ error: "Falha ao criar produto" });
    }
  }

  if (req.method === "PATCH") {
    const id = sanitizeString(payload.id);

    if (!id) {
      return res.status(400).json({ error: "ID do produto é obrigatório" });
    }

    const hasDelta = Object.prototype.hasOwnProperty.call(payload, "delta");

    if (hasDelta) {
      const deltaValue = Number(payload.delta);
      if (!Number.isFinite(deltaValue)) {
        return res.status(400).json({ error: "Variação de estoque inválida" });
      }

      const ref = db.collection("products").doc(id);

      try {
        let newStock = 0;
        await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(ref);
          if (!snap.exists) {
            const error = new Error("Produto não encontrado");
            error.status = 404;
            throw error;
          }
          const currentStock = Number(snap.data()?.stock) || 0;
          newStock = Math.max(currentStock + deltaValue, 0);
          transaction.update(ref, {
            stock: newStock,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: user.email,
          });
        });
        return res.status(200).json({ id, stock: newStock });
      } catch (err) {
        if (err.status === 404) {
          return res.status(404).json({ error: err.message });
        }
        console.error("Erro ao atualizar estoque:", err);
        return res.status(500).json({ error: "Falha ao atualizar estoque" });
      }
    }

    const ref = db.collection("products").doc(id);
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      const name = sanitizeString(payload.name);
      if (!name) {
        return res.status(400).json({ error: "Nome do produto é obrigatório" });
      }
      updates.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "brand")) {
      updates.brand = sanitizeString(payload.brand);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "ml")) {
      updates.ml = sanitizeString(payload.ml);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "notes")) {
      updates.notes = sanitizeString(payload.notes);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "category")) {
      updates.category = sanitizeString(payload.category);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "image")) {
      updates.image = sanitizeString(payload.image);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "featured")) {
      updates.featured = Boolean(payload.featured);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "price")) {
      const priceValue = Number(payload.price);
      if (!Number.isFinite(priceValue) || priceValue < 0) {
        return res.status(400).json({ error: "Preço inválido" });
      }
      updates.price = Math.round(priceValue * 100) / 100;
    }

    const fieldsToUpdate = Object.keys(updates);
    if (!fieldsToUpdate.length) {
      return res.status(400).json({ error: "Nenhum dado para atualizar" });
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.updatedBy = user.email;

    try {
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      await ref.update(updates);
      return res.status(200).json({ id, updated: true });
    } catch (err) {
      console.error("Erro ao atualizar produto:", err);
      return res.status(500).json({ error: "Falha ao atualizar produto" });
    }
  }

  if (req.method === "DELETE") {
    const id = sanitizeString(payload.id);
    if (!id) {
      return res.status(400).json({ error: "ID do produto é obrigatório" });
    }

    const ref = db.collection("products").doc(id);
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }
      await ref.delete();
      return res.status(200).json({ id });
    } catch (err) {
      console.error("Erro ao excluir produto:", err);
      return res.status(500).json({ error: "Falha ao excluir produto" });
    }
  }

  res.setHeader("Allow", "POST, PATCH, DELETE");
  return res.status(405).json({ error: "Método não permitido" });
};
