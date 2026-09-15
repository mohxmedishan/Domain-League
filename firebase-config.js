// 🔧 PASTE YOUR FIREBASE CONFIG HERE
// Firebase Console → Project Settings → Your apps → Web app → Config
export const firebaseConfig = {
  apiKey: "AIzaSyANNQcdS2dkibY8e1b3STerih_a_al5I2g",
  authDomain: "domain-league.firebaseapp.com",
  projectId: "domain-league",
  storageBucket: "domain-league.firebasestorage.app",
  messagingSenderId: "1095850963091",
  appId: "1:1095850963091:web:43b8e5581667a858f3dd66"
};

// Auto-detects whether you've filled the config in yet
export const FIREBASE_READY = !firebaseConfig.apiKey.includes("PASTE");
