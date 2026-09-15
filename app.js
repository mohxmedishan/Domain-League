import { firebaseConfig, FIREBASE_READY } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, getDoc, updateDoc, increment,
  collection, query, orderBy, limit, getDocs, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================================================
   INIT
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
   USER CACHE — instant nav paint, zero flash
   ========================================================= */
const CACHE_KEY = 'dl_user_cache_v1';
function readCache() {
  try { const r = localStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
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
let currentUser = null;
let currentProfile = null;
let authMode = 'login';
let acctTab = 'username';

/* =========================================================
   DOM
   ========================================================= */
const $ = (id) => document.getElementById(id);
const navAuth = $('navAuth');
const authModal = $('authModal');
const accountModal = $('accountModal');
const form = $('authForm');
const formError = $('formError');
const submitBtn = $('submitBtn');
const usernameField = $('usernameField');
const board = $('board');
const youSection = $('youSection');
const toast = $('toast');

/* =========================================================
   HELPERS
   ========================================================= */
function showToast(msg, ms = 2600) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), ms);
}
function initials(name) { return (name || '?').trim().slice(0, 2).toUpperCase(); }
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Request timed out. Check your connection.')), ms))
  ]);
}
const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

const ERRORS = {
  'auth/email-already-in-use': 'That email is already registered.',
  'auth/invalid-email': 'That email looks invalid.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'auth/operation-not-allowed': 'Email/password auth is disabled in Firebase.',
  'auth/requires-recent-login': 'Please log in again to change your password.'
};
const friendlyError = (err) => ERRORS[err?.code] || err?.message || 'Something went wrong.';

/* =========================================================
   NAV
   ========================================================= */
function paintNavFromProfile(profile) {
  if (!profile || !profile.username) {
    navAuth.innerHTML = `
      <button class="btn btn-ghost" data-open-auth="login">Log in</button>
      <button class="btn btn-primary" data-open-auth="signup">Sign up</button>`;
  } else {
    navAuth.innerHTML = `
      <button class="user-chip" id="userChip" type="button" title="Account settings">
        <span class="avatar">${esc(initials(profile.username))}</span>
        <span class="name">${esc(profile.username)}</span>
      </button>
      <button class="btn btn-ghost" id="logoutBtn">Log out</button>`;
    $('logoutBtn').addEventListener('click', logout);
    $('userChip').addEventListener('click', () => openAccountModal());
  }
  bindAuthButtons();
}
function bindAuthButtons() {
  document.querySelectorAll('[data-open-auth]').forEach((el) => {
    el.onclick = () => openAuthModal(el.dataset.openAuth);
  });
}

/* =========================================================
   AUTH MODAL
   ========================================================= */
function openAuthModal(mode = 'login') {
  setAuthMode(mode, { preserveValues: false });
  authModal.hidden = false;
  formError.textContent = '';
  setTimeout(() => (mode === 'signup' ? $('username') : $('email')).focus(), 60);
}
function closeAuthModal() { authModal.hidden = true; }

function setAuthMode(mode, { preserveValues = true } = {}) {
  authMode = mode;
  document.querySelectorAll('#authModal .modal-tabs button').forEach((b) =>
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
   PASSWORD TOGGLE (delegated — works for every eye button)
   ========================================================= */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-pass');
  if (!btn) return;
  const target = document.getElementById(btn.dataset.target);
  if (!target) return;
  const show = target.type === 'password';
  target.type = show ? 'text' : 'password';
  btn.classList.toggle('is-visible', show);
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

/* =========================================================
   ACCOUNT MODAL
   ========================================================= */
function openAccountModal(tab = null) {
  if (!currentUser) return;
  $('acctEmail').textContent = currentUser.email || '—';
  $('currentUsername').value = currentProfile?.username || '(not set)';
  $('newUsername').value = '';
  $('currentPassword').value = '';
  $('newPassword').value = '';
  $('usernameError').textContent = '';
  $('passwordError').textContent = '';
  setAccountTab(tab || (currentProfile?.username ? 'username' : 'username'));
  accountModal.hidden = false;
  setTimeout(() => (tab === 'password' ? $('currentPassword') : $('newUsername')).focus(), 60);
}
function closeAccountModal() { accountModal.hidden = true; }

function setAccountTab(tab) {
  acctTab = tab;
  document.querySelectorAll('#accountModal .modal-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.atab === tab)
  );
  $('usernameForm').hidden = tab !== 'username';
  $('passwordForm').hidden = tab !== 'password';
  $('usernameError').textContent = '';
  $('passwordError').textContent = '';
}

document.querySelectorAll('#accountModal .modal-tabs button').forEach((b) =>
  b.addEventListener('click', () => setAccountTab(b.dataset.atab))
);
$('accountClose').addEventListener('click', closeAccountModal);
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccountModal(); });

/* ---------- CHANGE USERNAME ---------- */
$('usernameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('usernameError');
  const btn = $('saveUsernameBtn');
  errEl.textContent = '';

  const newName = $('newUsername').value.trim();
  if (!currentUser) return errEl.textContent = 'Not signed in.';
  if (!USERNAME_RE.test(newName))
    return errEl.textContent = '3–16 chars, letters/numbers/underscore only.';
  if (newName === currentProfile?.username)
    return errEl.textContent = "That's already your username.";

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';

  try {
    // Uniqueness check (exclude self)
    const taken = await withTimeout(getDocs(
      query(collection(db, 'users'), where('username', '==', newName))
    ));
    const clash = taken.docs.find((d) => d.id !== currentUser.uid);
    if (clash) throw new Error('That username is taken.');

    // Update Firestore
    await withTimeout(updateDoc(doc(db, 'users', currentUser.uid), { username: newName }));
    // Update Firebase Auth displayName
    await updateProfile(currentUser, { displayName: newName });

    // Update local state + UI
    currentProfile = { ...(currentProfile || {}), uid: currentUser.uid, username: newName };
    writeCache(currentProfile);
    paintNavFromProfile(currentProfile);
    $('currentUsername').value = newName;
    $('newUsername').value = '';
    renderYou();
    renderBoard();
    showToast('Username updated ✅');
    setTimeout(closeAccountModal, 500);
  } catch (err) {
    errEl.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

/* ---------- CHANGE PASSWORD ---------- */
$('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('passwordError');
  const btn = $('savePasswordBtn');
  errEl.textContent = '';

  const current = $('currentPassword').value;
  const next = $('newPassword').value;

  if (!currentUser?.email) return errEl.textContent = 'Not signed in.';
  if (!current) return errEl.textContent = 'Enter your current password.';
  if (next.length < 6) return errEl.textContent = 'New password needs at least 6 characters.';
  if (next === current) return errEl.textContent = 'New password must be different.';

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Updating…';

  try {
    // Re-auth is required by Firebase before a password change
    const cred = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, cred);
    await updatePassword(currentUser, next);

    $('currentPassword').value = '';
    $('newPassword').value = '';
    showToast('Password updated 🔒');
    setTimeout(closeAccountModal, 500);
  } catch (err) {
    errEl.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

/* =========================================================
   SIGN UP / LOGIN
   ========================================================= */
async function handleSignup(username, email, password) {
  const taken = await withTimeout(getDocs(
    query(collection(db, 'users'), where('username', '==', username))
  ));
  if (!taken.empty) throw new Error('That username is taken.');

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // NOTE: no email on the doc — it lives in Firebase Auth only
  const profile = {
    username,
    totalScore: 0,
    gamesPlayed: 0,
    createdAt: serverTimestamp()
  };
  await withTimeout(setDoc(doc(db, 'users', cred.user.uid), profile));
  await updateProfile(cred.user, { displayName: username });
  return { uid: cred.user.uid, username };
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
      if (!USERNAME_RE.test(username))
        throw new Error('Username: 3–16 chars, letters/numbers/underscore only.');
      if (password.length < 6) throw new Error('Password needs at least 6 characters.');
      const profile = await handleSignup(username, email, password);
      const cached = { uid: profile.uid, username: profile.username, totalScore: 0, gamesPlayed: 0 };
      writeCache(cached);
      currentProfile = cached;
      paintNavFromProfile(cached);
      showToast(`Welcome to the League, ${username}! 🎮`);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast('Welcome back! 👋');
    }
    closeAuthModal();
    form.reset();
  } catch (err) {
    formError.textContent = friendlyError(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = prevLabel;
  }
});

async function logout() {
  try { await signOut(auth); } catch {}
  writeCache(null);
  currentUser = null;
  currentProfile = null;
  paintNavFromProfile(null);
  youSection.hidden = true;
  closeAccountModal();
  showToast('Logged out.');
}

/* =========================================================
   LEADERBOARD
   ========================================================= */
async function renderBoard() {
  if (!FIREBASE_READY) {
    board.innerHTML = `<div class="board-empty">
      🔧 Firebase isn't configured yet.<br />Add your keys to <code>firebase-config.js</code>.
    </div>`;
    return;
  }
  board.innerHTML = `<div class="board-loading">Loading rankings…</div>`;

  try {
    const snap = await withTimeout(getDocs(
      query(collection(db, 'users'), orderBy('totalScore', 'desc'), limit(10))
    ));
    if (snap.empty) {
      board.innerHTML = `<div class="board-empty">No players yet. Be the first. 👑</div>`;
      $('statPlayers').textContent = '0';
      $('statHigh').textContent = '0';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    board.innerHTML = snap.docs.map((d, i) => {
      const u = d.data();
      const isMe = currentUser && d.id === currentUser.uid;
      const rankClass = i < 3 ? 'rank gold' : 'rank';
      const name = u.username ? esc(u.username) : '<span style="color:var(--muted)">(no username)</span>';
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

    $('statPlayers').textContent = snap.size.toLocaleString();
    $('statHigh').textContent = (snap.docs[0].data().totalScore || 0).toLocaleString();
  } catch (err) {
    console.error('[leaderboard]', err);
    board.innerHTML = `<div class="board-empty">
      Couldn't load the leaderboard.<br />
      <span style="font-size:12px;opacity:.7">${esc(err.message)}</span>
    </div>`;
  }
}

/* =========================================================
   YOUR CARD
   ========================================================= */
async function renderYou() {
  if (!currentUser || !currentProfile?.username) { youSection.hidden = true; return; }
  youSection.hidden = false;
  $('youName').textContent = currentProfile.username;
  $('youScore').textContent = (currentProfile.totalScore || 0).toLocaleString();
  $('youGames').textContent = currentProfile.gamesPlayed || 0;
  try {
    const higher = await withTimeout(getDocs(
      query(collection(db, 'users'), where('totalScore', '>', currentProfile.totalScore || 0))
    ));
    $('youRank').textContent = '#' + (higher.size + 1);
  } catch { $('youRank').textContent = '—'; }
}

/* =========================================================
   SETUP BANNER — nudge users without a username
   ========================================================= */
function renderSetupBanner(show) {
  let el = document.getElementById('setupBanner');
  if (!show) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'setupBanner';
  el.className = 'setup-banner';
  el.innerHTML = `
    <p>👋 You're signed in, but you haven't set a username yet — pick one so your scores show up right on the board.</p>
    <button class="btn btn-primary" id="setupBannerBtn" type="button">Set username</button>`;
  const hero = document.querySelector('.hero');
  hero.insertBefore(el, hero.firstChild);
  $('setupBannerBtn').addEventListener('click', () => openAccountModal('username'));
}

/* =========================================================
   BOOT
   ========================================================= */

// STEP 1 — instant paint from cache
(function instantPaint() {
  const cached = readCache();
  if (cached && cached.username) {
    currentProfile = cached;
    paintNavFromProfile(cached);
  } else {
    paintNavFromProfile(null);
  }
  renderBoard();
  $('year').textContent = new Date().getFullYear();
})();

// STEP 2 — reconcile with Firebase
if (FIREBASE_READY) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (!user) {
      currentProfile = null;
      writeCache(null);
      paintNavFromProfile(null);
      youSection.hidden = true;
      renderSetupBanner(false);
      renderBoard();
      return;
    }

    try {
      const snap = await withTimeout(getDoc(doc(db, 'users', user.uid)));

      if (snap.exists() && snap.data().username) {
        // Happy path — use Firestore username (source of truth)
        currentProfile = { uid: user.uid, ...snap.data() };
        writeCache(currentProfile);
        paintNavFromProfile(currentProfile);
        renderSetupBanner(false);
        renderYou();
      } else {
        // Broken/incomplete profile — no username. Show a placeholder
        // in the nav, but do NOT use email prefix as the "name".
        currentProfile = {
          uid: user.uid,
          username: snap.exists() ? snap.data().username : '',
          totalScore: snap.data()?.totalScore || 0,
          gamesPlayed: snap.data()?.gamesPlayed || 0
        };
        paintNavFromProfile(currentProfile); // paints guest-style if no username
        renderSetupBanner(true);

        // Auto-open the account modal on the username tab so they fix it now
        setTimeout(() => openAccountModal('username'), 400);
      }
      renderBoard();
    } catch (err) {
      console.error('[reconcile]', err);
      const cached = readCache();
      if (cached?.username) {
        currentProfile = cached;
        paintNavFromProfile(cached);
      }
    }
  });
} else {
  renderYou();
}

/* =========================================================
   EVENTS
   ========================================================= */
document.querySelectorAll('#authModal .modal-tabs button').forEach((b) =>
  b.addEventListener('click', () => setAuthMode(b.dataset.tab, { preserveValues: true }))
);
$('modalClose').addEventListener('click', closeAuthModal);
authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeAuthModal(); closeAccountModal(); }
});

/* =========================================================
   GAME API
   ========================================================= */
window.DL = {
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  async submitScore(score) {
    if (!currentUser || !db) throw new Error('Sign in first.');
    if (!currentProfile?.username) throw new Error('Set a user