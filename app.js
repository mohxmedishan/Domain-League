import { firebaseConfig, FIREBASE_READY } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, getDoc, collection, query, orderBy, limit, getDocs,
  where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================================================
   INIT — Firestore with persistent cache
   ========================================================= */
let auth = null, db = null;
if (FIREBASE_READY) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
}

/* =========================================================
   USER CACHE — kills the auth flash on reload
   ========================================================= */
const CACHE_KEY = 'dl_user_cache_v1';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCache(profile) {
  try {
    if (profile) localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

/* =========================================================
   STATE
   ========================================================= */
let currentUser = null;       // Firebase user
let currentProfile = null;    // { username, totalScore, gamesPlayed, ... }
let authMode = 'login';
let authReady = false;        // true once Firebase has resolved initial state

/* =========================================================
   DOM
   ========================================================= */
const $ = (id) => document.getElementById(id);
const navAuth = $('navAuth');
const modal = $('authModal');
const form = $('authForm');
const formError = $('formError');
const submitBtn = $('submitBtn');
const usernameField = $('usernameField');
const board = $('board');
const youSection = $('youSection');
const toast = $('toast');
const passInput = $('password');
const togglePass = $('togglePass');

/* =========================================================
   HELPERS
   ========================================================= */
function showToast(msg, ms = 2600) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), ms);
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Wrap any promise with a timeout so Firestore never hangs forever
function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Request timed out. Check your connection or Firestore rules.')), ms)
    )
  ]);
}

const ERRORS = {
  'auth/email-already-in-use': 'That email is already registered.',
  'auth/invalid-email': 'That email looks invalid.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'auth/operation-not-allowed': 'Email/password auth is disabled in Firebase.'
};

function friendlyError(err) {
  return ERRORS[err?.code] || err?.message || 'Something went wrong.';
}

/* =========================================================
   NAV RENDERING — takes a profile-ish object (may come from cache)
   ========================================================= */
function paintNavFromProfile(profile) {
  if (!profile) {
    navAuth.innerHTML = `
      <button class="btn btn-ghost" data-open-auth="login">Log in</button>
      <button class="btn btn-primary" data-open-auth="signup">Sign up</button>`;
  } else {
    navAuth.innerHTML = `
      <span class="user-chip">
        <span class="avatar">${esc(initials(profile.username))}</span>
        <span class="name">${esc(profile.username || 'Player')}</span>
      </span>
      <button class="btn btn-ghost" id="logoutBtn">Log out</button>`;
    $('logoutBtn').addEventListener('click', logout);
  }
  bindAuthButtons();
}

function bindAuthButtons() {
  document.querySelectorAll('[data-open-auth]').forEach((el) => {
    el.onclick = () => openModal(el.dataset.openAuth);
  });
}

/* =========================================================
   MODAL
   ========================================================= */
function openModal(mode = 'login') {
  setMode(mode, { preserveValues: false });
  modal.hidden = false;
  formError.textContent = '';
  setTimeout(() => (mode === 'signup' ? $('username') : $('email')).focus(), 60);
}
function closeModal() { modal.hidden = true; }

function setMode(mode, { preserveValues = true } = {}) {
  authMode = mode;
  document.querySelectorAll('.modal-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === mode)
  );
  usernameField.hidden = mode !== 'signup';
  $('username').required = mode === 'signup';
  submitBtn.textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  formError.textContent = '';
  if (!preserveValues) form.reset();
}

/* =========================================================
   PASSWORD VISIBILITY TOGGLE
   ========================================================= */
function setPasswordVisible(visible) {
  passInput.type = visible ? 'text' : 'password';
  togglePass.classList.toggle('is-visible', visible);
  togglePass.setAttribute('aria-pressed', String(visible));
  togglePass.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
}
togglePass.addEventListener('click', () => {
  setPasswordVisible(passInput.type === 'password');
});

/* =========================================================
   AUTH ACTIONS
   ========================================================= */
async function handleSignup(username, email, password) {
  const taken = await withTimeout(getDocs(
    query(collection(db, 'users'), where('username', '==', username))
  ));
  if (!taken.empty) throw new Error('That username is taken.');

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const profile = {
    username,
    email,                       // kept on the doc for the owner; rules below block public read of this field? see note
    totalScore: 0,
    gamesPlayed: 0,
    createdAt: serverTimestamp()
  };
  await withTimeout(setDoc(doc(db, 'users', cred.user.uid), profile));
  await updateProfile(cred.user, { displayName: username });
  return { uid: cred.user.uid, ...profile };
}

async function handleLogin(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';
  submitBtn.disabled = true;
  const prevLabel = submitBtn.textContent;
  submitBtn.textContent = 'Working…';

  const username = $('username').value.trim();
  const email = $('email').value.trim();
  const password = $('password').value;

  try {
    if (!FIREBASE_READY) throw new Error('Firebase not configured yet — edit firebase-config.js');

    if (authMode === 'signup') {
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
        throw new Error('Username: 3–16 chars, letters/numbers/underscore only.');
      if (password.length < 6) throw new Error('Password needs at least 6 characters.');
      const profile = await handleSignup(username, email, password);
      // Optimistic cache update so nav paints instantly
      const cached = { uid: profile.uid, username: profile.username, totalScore: 0, gamesPlayed: 0 };
      writeCache(cached);
      currentProfile = cached;
      paintNavFromProfile(cached);
      showToast(`Welcome to the League, ${username}! 🎮`);
    } else {
      await handleLogin(email, password);
      showToast('Welcome back! 👋');
    }
    closeModal();
    form.reset();
  } catch (err) {
    formError.textContent = friendlyError(err);
    // Do NOT reset fields — user keeps their input on error
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = prevLabel;
  }
});

async function logout() {
  try {
    await signOut(auth);
  } catch {}
  writeCache(null);
  currentUser = null;
  currentProfile = null;
  paintNavFromProfile(null);
  youSection.hidden = true;
  showToast('Logged out.');
}

/* =========================================================
   LEADERBOARD
   ========================================================= */
async function renderBoard() {
  if (!FIREBASE_READY) {
    board.innerHTML = `<div class="board-empty">
      🔧 Firebase isn't configured yet.<br />
      Add your keys to <code>firebase-config.js</code> to go live.
    </div>`;
    return;
  }

  board.innerHTML = `<div class="board-loading">Loading rankings…</div>`;

  try {
    const snap = await withTimeout(getDocs(
      query(collection(db, 'users'), orderBy('totalScore', 'desc'), limit(10))
    ));

    if (snap.empty) {
      board.innerHTML = `<div class="board-empty">
        No players yet. Be the first to claim the throne. 👑
      </div>`;
      $('statPlayers').textContent = '0';
      $('statHigh').textContent = '0';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const rows = snap.docs.map((d, i) => {
      const u = d.data();
      const isMe = currentUser && d.id === currentUser.uid;
      const rankClass = i < 3 ? 'rank gold' : 'rank';
      const name = esc(u.username || 'Anonymous');
      return `
        <div class="row ${isMe ? 'me' : ''}">
          <div class="${rankClass}">${medals[i] || '#' + (i + 1)}</div>
          <div class="row-name">
            <div class="avatar">${esc(initials(u.username))}</div>
            ${name}${isMe ? ' <span style="color:var(--muted);font-weight:400">(you)</span>' : ''}
          </div>
          <div class="row-score">${(u.totalScore || 0).toLocaleString()}</div>
        </div>`;
    }).join('');
    board.innerHTML = rows;

    $('statPlayers').textContent = snap.size.toLocaleString();
    $('statHigh').textContent = (snap.docs[0].data().totalScore || 0).toLocaleString();
  } catch (err) {
    console.error('[leaderboard]', err);
    board.innerHTML = `<div class="board-empty">
      Couldn't load the leaderboard.<br />
      <span style="font-size:12px;opacity:.7">${esc(err.message || 'Unknown error')}</span>
    </div>`;
  }
}

/* =========================================================
   YOUR CARD
   ========================================================= */
async function renderYou() {
  if (!currentUser || !currentProfile) { youSection.hidden = true; return; }
  youSection.hidden = false;
  $('youName').textContent = currentProfile.username;
  $('youScore').textContent = (currentProfile.totalScore || 0).toLocaleString();
  $('youGames').textContent = currentProfile.gamesPlayed || 0;

  try {
    const higher = await withTimeout(getDocs(
      query(collection(db, 'users'), where('totalScore', '>', currentProfile.totalScore || 0))
    ));
    $('youRank').textContent = '#' + (higher.size + 1);
  } catch {
    $('youRank').textContent = '—';
  }
}

/* =========================================================
   BOOT — instant paint, then reconcile with Firebase
   ========================================================= */

// STEP 1 — Paint nav from cache on the very first frame.
// If there is no cache, guest buttons appear — which is correct, not a flash.
(function instantPaint() {
  const cached = readCache();
  if (cached) {
    currentProfile = cached;
    paintNavFromProfile(cached);
  } else {
    paintNavFromProfile(null);
  }
  renderBoard();
  $('year').textContent = new Date().getFullYear();
})();

// STEP 2 — Let Firebase tell us the truth, and reconcile.
if (FIREBASE_READY) {
  // onAuthStateChanged fires on initial load AND on every login/logout
  onAuthStateChanged(auth, async (user) => {
    authReady = true;
    currentUser = user;

    if (!user) {
      // Logged out — clear everything
      currentProfile = null;
      writeCache(null);
      paintNavFromProfile(null);
      youSection.hidden = true;
      renderBoard();
      return;
    }

    // Logged in — fetch the profile (cache-first via Firestore persistence)
    try {
      const snap = await withTimeout(getDoc(doc(db, 'users', user.uid)));
      if (snap.exists()) {
        currentProfile = { uid: user.uid, ...snap.data() };
      } else {
        // Edge case: user exists in Auth but no Firestore doc (e.g. signup failed midway)
        currentProfile = {
          uid: user.uid,
          username: user.displayName || user.email?.split('@')[0] || 'Player',
          totalScore: 0,
          gamesPlayed: 0
        };
        await setDoc(doc(db, 'users', user.uid), {
          username: currentProfile.username,
          totalScore: 0,
          gamesPlayed: 0,
          createdAt: serverTimestamp()
        }).catch(() => {});
      }
      writeCache(currentProfile);
      paintNavFromProfile(currentProfile);
      renderYou();
      renderBoard();
    } catch (err) {
      console.error('[auth reconcile]', err);
      // Fall back to cache so the UI isn't broken
      const cached = readCache();
      if (cached) {
        currentProfile = cached;
        paintNavFromProfile(cached);
      }
    }
  });
} else {
  // No Firebase configured — nothing else to do
  renderYou();
}

/* =========================================================
   EVENTS
   ========================================================= */
document.querySelectorAll('.modal-tabs button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.tab, { preserveValues: true }))
);
$('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* =========================================================
   EXPOSE HELPER FOR THE GAME MODULE (Game 01 etc.)
   =========================================================
   From your game code, call:
     window.DL.submitScore(score)
   It will increment totalScore + gamesPlayed atomically and refresh the UI.
   ========================================================= */
import { increment, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.DL = {
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  async submitScore(score) {
    if (!currentUser || !db) throw new Error('You must be signed in to submit a score.');
    const n = Math.max(0, Math.floor(Number(score) || 0));
    const ref = doc(db, 'users', currentUser.uid);
    await updateDoc(ref, {
      totalScore: increment(n),
      gamesPlayed: increment(1)
    });
    // Optimistic local update
    if (currentProfile) {
      currentProfile.totalScore = (currentProfile.totalScore || 0) + n;
      currentProfile.gamesPlayed = (currentProfile.gamesPlayed || 0) + 1;
      writeCache(currentProfile);
      renderYou();
    }
    renderBoard();
    return n;
  }
};
