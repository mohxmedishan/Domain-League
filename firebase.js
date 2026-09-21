// Anonymous, accountless Firebase access. No Firebase Auth.
import { firebaseConfig, FIREBASE_READY } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
let db = null;
if (FIREBASE_READY) {
  const app = initializeApp(firebaseConfig);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
}
export { FIREBASE_READY, db, collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp };
