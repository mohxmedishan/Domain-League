// app.js — Domain League UI
import {
  FIREBASE_READY, auth, db,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
  doc, setDoc, getDoc, updateDoc, increment,
  collection, query, orderBy, limit, getDocs, where, serverTimestamp
} from './firebase.js';

const CACHE_KEY = 'dl_user_cache_v2';
let currentUser = null;
let currentProfile = null;
let authMode = 'login';

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
const heroCtaPrimary = $('heroCtaPrimary');

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

function showToast(msg, ms = 2600) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), ms);
}
function initials(name) { return (name || '?').trim().slice(0, 2).toUpperCase() || '?'; }
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Request timed out.')), ms))
  ]);
}
function readCache() {
  try { const r = localStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function writeCache(profile) {
  try {
    if (profile && profile.uid) localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}
const friendlyError = (err) => ERRORS[err?.code] || err?.message || 'Something went wrong.';

/* ---------- NAV ---------- */
function paintNav({ hasUser, profile }) {
  if (!hasUser) {
    navAuth.innerHTML = `
      <button class="btn btn-ghost" data-open-auth="login" type="button">Log in</button>
      <button class="btn btn-primary" data-open-auth="signup" type="button">Sign up</button>`;
  } else {
    const hasName = !!(profile && profile.username);
    const displayName = hasName ? profile.username : 'Set username';
    const avatarCls = hasName ? 'avatar' : 'avatar placeholder';
    const chipCls = hasName ? 'user-chip' : 'user-chip incomplete';
    navAuth.innerHTML = `
      <button class="${chipCls}" id="userChip" type="button">
        <span class="${avatarCls}">${hasName ? esc(initials(profile.username)) : '?'}</span>
        <span class="name">${esc(displayName)}</span>
        ${!hasName ? '<span class="warn-badge">Required</span>' : ''}
      </button>
      <button class="btn btn-ghost" id="logoutBtn" type="button">Log out</button>`;
    $('logoutBtn').addEventListener('click', logout);
    $('userChip').addEventListener('click', () => openAccountModal());
  }
  bindAuthButtons();
  renderHeroCta(hasUser);
}
function renderHeroCta(hasUser) {
  const btn = document.getElementById('heroCtaPrimary');
  if (!btn) return;
  if (!hasUser) {
    btn.textContent = 'Create your account';
    btn.onclick = () => openAuthModal('signup');
    return;
  }
  const hasName = !!(currentProfile && currentProfile.username);
  btn.textContent = hasName ? 'View your card' : 'Set your username';
  btn.onclick = () => {
    if (!hasName) {
      openAccountModal('username');
      return;
    }
    // Make sure the card is visible before scrolling to it
    youSection.hidden = false;
    youSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Flash it so you can see it's the target
    youSection.animate(
      [{ outline: '2px solid transparent' },
       { outline: '2px solid var(--accent)' },
       { outline: '2px solid transparent' }],
      { duration: 1200, easing: 'ease-out' }
    );
  };
}

/* ---------- AUTH MODAL ---------- */
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

/* ---------- PASSWORD TOGGLE (delegated) ---------- */
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

/* ---------- ACCOUNT MODAL ---------- */
function openAccountModal(tab = null) {
  if (!currentUser) return;
  $('acctEmail').textContent = currentUser.email || '—';
  $('currentUsername').value = currentProfile?.username || '(not set)';
  $('newUsername').value = '';
  $('currentPassword').value = '';
  $('newPassword').value = '';
  $('usernameError').textContent = '';
  $('passwordError').textContent = '';
  setAccountTab(tab || 'username');
  accountModal.hidden = false;
  setTimeout(() => (tab === 'password' ? $('currentPassword') : $('newUsername')).focus(), 60);
}
function closeAccountModal() { accountModal.hidden = true; }
function setAccountTab(tab) {
  document.querySelectorAll('#accountModal .modal-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.atab === tab)
  );
  $('usernameForm').hidden = tab !== 'username';
  $('passwordForm').hidden = tab !== 'password';
  $('usernameError').textContent = '';
  $('passwordError').textContent = '';
}

/* ---------- CHANGE USERNAME ---------- */
$('usernameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('usernameError');
  const btn = $('saveUsernameBtn');
  errEl.textContent = '';
  const newName = $('newUsername').value.trim();
  if (!currentUser) return errEl.textContent = 'Not signed in.';
  if (!USERNAME_RE.test(newName)) return errEl.textContent = '3–16 chars, letters/numbers/underscore only.';
  if (newName === currentProfile?.username) return errEl.textContent = "That's already your username.";
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const taken = await withTimeout(getDocs(query(collection(db, 'users'), where('username', '==', newName))));
    const clash = taken.docs.find((d) => d.id !== currentUser.uid);
    if (clash) throw new Error('That username is taken.');
    await withTimeout(setDoc(doc(db, 'users', currentUser.uid), {
      username: newName,
      totalScore: currentProfile?.totalScore ?? 0,
      gamesPlayed: currentProfile?.gamesPlayed ?? 0
    }, { merge: true }));
    await updateProfile(currentUser, { displayName: newName });
    currentProfile = { ...(currentProfile || {}), uid: currentUser.uid, username: newName,
      totalScore: currentProfile?.totalScore ?? 0, gamesPlayed: currentProfile?.gamesPlayed ?? 0 };
    writeCache(currentProfile);
    paintNav({ hasUser: true, profile: currentProfile });
    $('currentUsername').value = newName;
    $('newUsername').value = '';
    renderYou();
    renderBoard();
    showToast('Username updated ✅');
    setTimeout(closeAccountModal, 500);
  } catch (err) { errEl.textContent = friendlyError(err); }
  finally { btn.disabled = false; btn.textContent = prev; }
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
    const cred = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, cred);
    await updatePassword(currentUser, next);
    $('currentPassword').value = '';
    $('newPassword').value = '';
    showToast('Password updated 🔒');
    setTimeout(closeAccountModal, 500);
  } catch (err) { errEl.textContent = friendlyError(err); }
  finally { btn.disabled = false; btn.textContent = prev; }
});

/* ---------- SIGN UP / LOGIN ---------- */
async function handleSignup(username, email, password) {
  const taken = await withTimeout(getDocs(query(collection(db, 'users'), where('username', '==', username))));
  if (!taken.empty) throw new Error('That username is taken.');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const profile = { username, totalScore: 0, gamesPlayed: 0, createdAt: serverTimestamp() };
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
    if (!FIREBASE_READY) throw new Error('Firebase not configured yet.');
    if (authMode === 'signup') {
      if (!USERNAME_RE.test(username)) throw new Error('Username: 3–16 chars, letters/numbers/underscore only.');
      if (password.length < 6) throw new Error('Password needs at least 6 characters.');
      const profile = await handleSignup(username, email, password);
      currentProfile = { uid: profile.uid, username: profile.username, totalScore: 0, gamesPlayed: 0 };
      writeCache(currentProfile);
      paintNav({ hasUser: true, profile: currentProfile });
      showToast(`Welcome to the League, ${username}! 🎮`);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast('Welcome back! 👋');
    }
    closeAuthModal();
    form.reset();
  } catch (err) { formError.textContent = friendlyError(err); }
  finally { submitBtn.disabled = false; submitBtn.textContent = prevLabel; }
});

async function logout() {
  try { await signOut(auth); } catch {}
  writeCache(null);
  currentUser = null;
  currentProfile = null;
  paintNav({ hasUser: false });
  youSection.hidden = true;
  closeAccountModal();
  showToast('Logged out.');
}

/* ---------- LEADERBOARD ---------- */
async function renderBoard() {
  if (!FIREBASE_READY) {
    board.innerHTML = `<div class="board-empty">🔧 Firebase isn't configured yet.</div>`;
    return;
  }
  board.innerHTML = `<div class="board-loading">Loading rankings…</div>`;
  try {
    const snap = await withTimeout(getDocs(query(collection(db, 'users'), orderBy('totalScore', 'desc'), limit(10))));
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
      return `<div class="row ${isMe ? 'me' : ''}">
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
    board.innerHTML = `<div class="board-empty">Couldn't load the leaderboard.<br /><span style="font-size:12px;opacity:.7">${esc(err.message)}</span></div>`;
  }
}

/* ---------- YOUR CARD ---------- */
async function renderYou() {
  if (!currentUser || !currentProfile?.username) { youSection.hidden = true; return; }
  youSection.hidden = false;
  $('youName').textContent = currentProfile.username;
  $('youScore').textContent = (currentProfile.totalScore || 0).toLocaleString();
  $('youGames').textContent = currentProfile.gamesPlayed || 0;
  try {
    const higher = await withTimeout(getDocs(query(collection(db, 'users'), where('totalScore', '>', currentProfile.totalScore || 0))));
    $('youRank').textContent = '#' + (higher.size + 1);
  } catch { $('youRank').textContent = '—'; }
}

/* ---------- SETUP BANNER ---------- */
function renderSetupBanner(show) {
  let el = document.getElementById('setupBanner');
  if (!show) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'setupBanner';
  el.className = 'setup-banner';
  el.innerHTML = `<p>👋 You're signed in, but you haven't set a username yet — pick one so your scores show up right on the board.</p>
    <button class="btn btn-primary" id="setupBannerBtn" type="button">Set username</button>`;
  document.querySelector('.hero').insertBefore(el, document.querySelector('.hero').firstChild);
  $('setupBannerBtn').addEventListener('click', () => openAccountModal('username'));
}

/* ---------- BOOT ---------- */
(function instantPaint() {
  const cached = readCache();
  if (cached && cached.uid) {
    currentProfile = cached;
    paintNav({ hasUser: true, profile: cached });
  } else {
    paintNav({ hasUser: false });
  }
  renderBoard();
  $('year').textContent = new Date().getFullYear();
})();

if (FIREBASE_READY) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) {
      currentProfile = null;
      writeCache(null);
      paintNav({ hasUser: false });
      youSection.hidden = true;
      renderSetupBanner(false);
      renderBoard();
      return;
    }
    try {
      const snap = await withTimeout(getDoc(doc(db, 'users', user.uid)));
      const data = snap.exists() ? snap.data() : {};
      currentProfile = {
        uid: user.uid,
        username: data.username || '',
        totalScore: data.totalScore || 0,
        gamesPlayed: data.gamesPlayed || 0
      };
      writeCache(currentProfile);
      paintNav({ hasUser: true, profile: currentProfile });
      if (!currentProfile.username) {
        renderSetupBanner(true);
        renderYou();
      } else {
        renderSetupBanner(false);
        renderYou();
      }
      renderBoard();
    } catch (err) {
      console.error('[reconcile]', err);
      paintNav({ hasUser: true, profile: currentProfile || readCache() || { username: '' } });
    }
  });
} else {
  renderYou();
}

/* ---------- GLOBAL EVENT DELEGATION ---------- */
document.addEventListener('click', (e) => {
  // 1. Password toggle (works in every form)
  const toggle = e.target.closest('.toggle-pass');
  if (toggle && toggle.dataset.target) {
    const target = document.getElementById(toggle.dataset.target);
    if (target) {
      const show = target.type === 'password';
      target.type = show ? 'text' : 'password';
      toggle.classList.toggle('is-visible', show);
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    }
    return;
  }

  // 2. Close buttons
  if (e.target.closest('#modalClose')) { closeAuthModal(); return; }
  if (e.target.closest('#accountClose')) { closeAccountModal(); return; }

  // 3. Backdrop click closes the modal
  if (e.target.classList.contains('modal-backdrop')) {
    if (e.target.id === 'authModal') closeAuthModal();
    if (e.target.id === 'accountModal') closeAccountModal();
    return;
  }

  // 4. Auth modal tabs (Log in / Sign up)
  const authTab = e.target.closest('#authModal .modal-tabs button');
  if (authTab && authTab.dataset.tab) {
    setAuthMode(authTab.dataset.tab, { preserveValues: true });
    return;
  }

  // 5. Account modal tabs (Username / Password)
  const acctTab = e.target.closest('#accountModal .modal-tabs button');
  if (acctTab && acctTab.dataset.atab) {
    setAccountTab(acctTab.dataset.atab);
    return;
  }
});

// Escape closes any open modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeAuthModal(); closeAccountModal(); }
});

/* ---------- GAME API ---------- */
window.DL = {
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  async submitScore(score) {
    if (!currentUser || !db) throw new Error('Sign in first.');
    if (!currentProfile?.username) throw new Error('Set a username before submitting scores.');
    const n = Math.max(0, Math.floor(Number(score) || 0));
    await updateDoc(doc(db, 'users', currentUser.uid), {
      totalScore: increment(n),
      gamesPlayed: increment(1)
    });
    currentProfile.totalScore = (currentProfile.totalScore || 0) + n;
    currentProfile.gamesPlayed = (currentProfile.gamesPlayed || 0) + 1;
    writeCache(currentProfile);
    renderYou();
    renderBoard();
    return n;
  }
};
