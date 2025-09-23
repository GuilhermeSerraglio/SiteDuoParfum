(function(){
  const config = {
    apiKey: "AIzaSyDVkpsr4z6LolEOkNTGcc9TmKeiu4-mi1Y",
    authDomain: "duoparfum-61ec2.firebaseapp.com",
    projectId: "duoparfum-61ec2",
    storageBucket: "duoparfum-61ec2.firebasestorage.app",
    messagingSenderId: "889684986920",
    appId: "1:889684986920:web:9d452daf2192124b19391d"
  };

  if (typeof window === "undefined") {
    return;
  }

  window.firebaseConfig = config;

  if (!window.firebase) {
    console.error("Firebase SDK não carregado. Verifique a ordem dos scripts.");
    return;
  }

  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(config);
  }
})();
