const admin = require("firebase-admin");

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
      console.error("⚠️ FIREBASE_SERVICE_ACCOUNT inválido:", err);
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
      console.error("⚠️ FIREBASE_SERVICE_ACCOUNT_BASE64 inválido:", err);
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

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const credentials = loadServiceAccountFromEnv();

    if (!credentials) {
      throw new Error(
        "⚠️ Credenciais do Firebase Admin não configuradas. Defina FIREBASE_SERVICE_ACCOUNT (JSON), FIREBASE_SERVICE_ACCOUNT_BASE64 ou as variáveis FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY."
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

  return admin;
}

module.exports = { getFirebaseAdmin };
