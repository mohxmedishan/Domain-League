// 🔧 PASTE YOUR FIREBASE CONFIG HERE
// Firebase Console → Project Settings → Your apps → Web app → Config
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// Auto-detects whether you've filled the config in yet
export const FIREBASE_READY = !firebaseConfig.apiKey.includes("PASTE");
