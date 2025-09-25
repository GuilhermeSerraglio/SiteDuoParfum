(function () {
  const REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

  function buildMissingConfigError() {
    return new Error(
      "Configuração do Firebase ausente. Defina as variáveis FIREBASE_WEB_* na Vercel ou injete window.firebaseConfig antes de carregar firebase-init.js."
    );
  }

  function isBrowser() {
    return typeof window !== "undefined";
  }

  function isValidConfig(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }

    return REQUIRED_KEYS.every((key) => {
      const value = candidate[key];
      return typeof value === "string" && value.trim();
    });
  }

  async function fetchRemoteConfig() {
    if (!isBrowser()) {
      return null;
    }

    try {
      const response = await fetch("/api/firebase-config", {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return isValidConfig(data) ? data : null;
    } catch (err) {
      console.warn("Não foi possível carregar configuração remota do Firebase:", err);
      return null;
    }
  }

  async function resolveFirebaseConfig() {
    if (isBrowser() && window.firebaseConfig && isValidConfig(window.firebaseConfig)) {
      return window.firebaseConfig;
    }

    const remoteConfig = await fetchRemoteConfig();
    if (remoteConfig) {
      return remoteConfig;
    }

    throw buildMissingConfigError();
  }

  if (!isBrowser()) {
    return;
  }

  if (typeof window.getFirebaseConfig !== "function") {
    const configPromise = resolveFirebaseConfig()
      .then((config) => {
        window.firebaseConfig = config;
        return config;
      })
      .catch((err) => {
        console.error("Não foi possível obter a configuração do Firebase:", err);
        throw err;
      });

    window.getFirebaseConfig = () => configPromise;
  }

  if (!window.firebase) {
    console.error("Firebase SDK não carregado. Verifique a ordem dos scripts.");
    return;
  }

  window
    .getFirebaseConfig()
    .then((config) => {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(config);
      }
    })
    .catch((err) => {
      console.error("Inicialização automática do Firebase abortada:", err);
    });
})();
