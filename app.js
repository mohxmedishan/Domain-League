import { firebaseConfig, FIREBASE_READY } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, query, orderBy,
  limit, getDocs, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- INIT ---------- */
let auth = null, db = null;
if (FIREBASE_READY) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

let currentUser = null;
let currentProfile = null;
let authMode = 'login';

/* ---------- DOM ---------- */
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

/* ---------- HELPERS ---------- */
function showToast(msg, ms = 2600) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), ms);
}

function initials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

const ERRORS = {
  'auth/email-already-in-use': 'That email is already registered.',
  'auth/invalid-email': 'That email looks invalid.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.'
};

function friendlyError(err) {
  return ERRORS[err?.code] || ERRORS[err?.message] || err?.message || 'Something went wrong.';
}

/* ---------- MODAL ---------- */
function openModal(mode = 'login') {
  authMode = mode;
  setMode(mode);
  modal.hidden = false;
  formError.textContent = '';
  form.reset();
  setTimeout(() => (mode === 'signup' ? $('username') : $('email')).focus(), 60);
}

function closeModal() { modal.hidden = true; }

function setMode(mode) {
  authMode = mode;
  document.querySelectorAll('.modal-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === mode)
  );
  usernameField.hidden = mode !== 'signup';
  $('username').required = mode === 'signup';
  submitBtn.textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  formError.textContent = '';
}

/* ---------- AUTH ACTIONS ---------- */
async function handleSignup(username, email, password) {
  // username availability check
  const taken = await getDocs(
    query(collection(db, 'users'), where('username', '==', username))
  );
  if (!taken.empty) throw new Error('That username is taken.');

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    username,
    totalScore: 0,
    gamesPlayed: 0,
    createdAt: serverTimestamp()
  });
  await updateProfile(cred.user, { displayName: username });
}

async function handleLogin(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Working…';

  const username = $('username').value.trim();
  const email = $('email').value.trim();
  const password = $('password').value;

  try {
    if (!FIREBASE_READY) throw new Error('Firebase not configured yet — see firebase-config.js');

    if (authMode === 'signup') {
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
        throw new Error('Username: 3–16 chars, letters/numbers/underscore only.');
      if (password.length < 6) throw new Error('Password needs at least 6 characters.');
      await handleSignup(username, email, password);
      showToast(`Welcome to the League, ${username}! 🎮`);
    } else {
      await handleLogin(email, password);
      showToast('Welcome back! 👋');
    }
    closeModal();
  } catch (err) {
    formError.textContent = friendlyError(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = authMode === 'signup' ? 'Create account' : 'Log in';
  }
});

async function logout() {
  await signOut(auth);
  currentProfile = null;
  showToast('Logged out.');
  renderNav();
  renderYou();
}

/* ---------- RENDER: NAV ---------- */
function renderNav() {
  if (!currentUser) {
    navAuth.innerHTML = `
      <button class="btn btn-ghost" data-open-auth="login">Log in</button>
      <button class="btn btn-primary" data-open-auth="signup">Sign up</button>`;
  } else {
    const name = currentProfile?.username || currentUser.displayName || 'Player';
    navAuth.innerHTML = `
      <span style="font-size:14px;font-weight:600;color:var(--muted)">
        ${name}
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

/* ---------- RENDER: LEADERBOARD ---------- */
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
    const snap = await getDocs(
      query(collection(db, 'users'), orderBy('totalScore', 'desc'), limit(10))
    );

    if (snap.empty) {
      board.innerHTML = `<div class="board-empty">
        No players yet. Be the first to claim the throne. 👑
      </div>`;
      $('statPlayers').textContent = '0';
      $('statHigh').textContent = '0';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    board.innerHTML = snap.docs.map((d, i) => {
      const u = d.data();
      const isMe = currentUser && d.id === currentUser.uid;
      const rankClass = i < 3 ? 'rank gold' : 'rank';
      return `
        <div class="row ${isMe ? 'me' : ''}">
          <div class="${rankClass}">${medals[i] || '#' + (i + 1)}</div>
          <div class="row-name">
            <div class="avatar">${initials(u.username)}</div>
            ${u.username || 'Anonymous'}${isMe ? ' <span style="color:var(--muted);font-weight:400">(you)</span>' : ''}
          </div>
          <div class="row-score">${(u.totalScore || 0).toLocaleString()}</div>
        </div>`;
    }).join('');

    // hero stats
    const all = await getDocs(collection(db, 'users'));
    $('statPlayers').textContent = all.size.toLocaleString();
    $('statHigh').textContent = (snap.docs[0].data().totalScore || 0).toLocaleString();
  } catch (err) {
    console.error(err);
    board.innerHTML = `<div class="board-empty">
      Couldn't load the leaderboard. Check your Firestore rules.
    </div>`;
  }
}

/* ---------- RENDER: YOUR CARD ---------- */
async function renderYou() {
  if (!currentUser || !currentProfile) { youSection.hidden = true; return; }
  youSection.hidden = false;
  $('youName').textContent = currentProfile.username;
  $('youScore').textContent = (currentProfile.totalScore || 0).toLocaleString();
  $('youGames').textContent = currentProfile.gamesPlayed || 0;

  // global rank
  try {
    const higher = await getDocs(
      query(collection(db, 'users'), where('totalScore', '>', currentProfile.totalScore || 0))
    );
    $('youRank').textContent = '#' + (higher.size + 1);
  } catch { $('youRank').textContent = '—'; }
}

/* ---------- AUTH STATE ---------- */
if (FIREBASE_READY) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentProfile = null;
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid));
      currentProfile = snap.exists() ? snap.data() : null;
    }
    renderNav();
    renderYou();
    renderBoard();
  });
} else {
  renderNav();
  renderBoard();
}

/* ---------- EVENTS ---------- */
document.querySelectorAll('.modal-tabs button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.tab))
);
$('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

$('year').textContent = new Date().getFullYear();
