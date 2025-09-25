const allowedMethod = "GET";

function buildConfigFromEnv() {
  const config = {
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_WEB_PROJECT_ID,
    storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_WEB_APP_ID,
    measurementId: process.env.FIREBASE_WEB_MEASUREMENT_ID,
  };

  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => typeof value === "string" && value.trim())
  );
}

module.exports = function handler(req, res) {
  if (req.method !== allowedMethod) {
    res.setHeader("Allow", allowedMethod);
    return res.status(405).json({ error: "Método não permitido" });
  }

  const config = buildConfigFromEnv();

  if (!Object.keys(config).length) {
    return res.status(200).json({});
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json(config);
};
