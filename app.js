// app.js — Domain League, accountless arcade
import {
  FIREBASE_READY, db,
  addDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp
} from './firebase.js';

const GAME_ID = 'game-01';
const PLAYER_KEY = 'dl_player_name_v1';
const PROGRESS_KEY = 'dl_game_progress_v1';
const SETTINGS_KEY = 'dl_settings_v1';
const RATE_KEY = 'dl_score_rate_v1';

const $ = (id) => document.getElementById(id);
const navAuth = $('navAuth');
const board = $('board');
const youSection = $('youSection');
const toast = $('toast');
const nameModal = $('nameModal');
const nameForm = $('nameForm');
const nameInput = $('playerName');
const nameError = $('nameError');

const NAME_RE = /^[a-zA-Z0-9 _.-]{2,20}$/;
const GAME_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const SCORE_MAX = 2147483647;
const MAX_SUBMISSIONS = 5;
const RATE_WINDOW_MS = 30_000;

const PROFANITY = [
  'fuck','shit','bitch','cunt','nigger','nigga','faggot','fag','slut','whore',
  'dick','pussy','cock','asshole','motherfucker'
];

function showToast(msg, ms = 2600) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), ms);
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase() || '?';
}

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out.')), ms))
  ]);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function hasProfanity(name) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return PROFANITY.some(word => new RegExp(`(^|\\s)${word}(\\s|$)`, 'i').test(normalized));
}

function generateGuestName() {
  return `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
}

function getPlayerName() {
  let name = '';
  try { name = localStorage.getItem(PLAYER_KEY) || ''; } catch {}
  if (NAME_RE.test(name) && !hasProfanity(name)) return name;

  const generated = generateGuestName();
  try { localStorage.setItem(PLAYER_KEY, generated); } catch {}
  return generated;
}

function setPlayerName(name) {
  try { localStorage.setItem(PLAYER_KEY, name); } catch {}
}

function getProgress() {
  return readJSON(PROGRESS_KEY, {});
}

function saveProgress(gameId, progress) {
  if (!GAME_ID_RE.test(gameId)) throw new Error('Invalid game ID.');
  const all = getProgress();
  all[gameId] = progress;
  writeJSON(PROGRESS_KEY, all);
}

function getSettings() {
  return readJSON(SETTINGS_KEY, {});
}

function setSettings(patch) {
  writeJSON(SETTINGS_KEY, { ...getSettings(), ...patch });
}

function validateScorePayload(gameId, playerName, score) {
  if (!GAME_ID_RE.test(String(gameId))) throw new Error('Invalid game ID.');
  if (!NAME_RE.test(playerName)) throw new Error('Display name must be 2–20 characters.');
  if (hasProfanity(playerName)) throw new Error('Please choose a different display name.');
  if (!Number.isInteger(score) || score < 0 || score > SCORE_MAX) {
    throw new Error('Score must be a valid non-negative integer.');
  }
}

function checkRateLimit() {
  const now = Date.now();
  const recent = readJSON(RATE_KEY, []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= MAX_SUBMISSIONS) {
    const wait = Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000);
    throw new Error(`Too many score submissions. Try again in ${wait}s.`);
  }
  recent.push(now);
  writeJSON(RATE_KEY, recent);
}

/* ---------- NAV / PLAYER NAME ---------- */
function paintNav() {
  const name = getPlayerName();
  navAuth.innerHTML = `
    <button class="user-chip" id="playerChip" type="button" title="Change display name">
      <span class="avatar">${esc(initials(name))}</span>
      <span class="name">${esc(name)}</span>
    </button>`;
  $('playerChip').addEventListener('click', () => openNameModal());
  renderHeroCta();
}

function renderHeroCta() {
  const btn = $('heroCtaPrimary');
  if (!btn) return;
  btn.textContent = 'Play now';
  btn.onclick = () => $('arcade')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openNameModal() {
  nameInput.value = getPlayerName();
  nameError.textContent = '';
  nameModal.hidden = false;
  setTimeout(() => nameInput.focus(), 50);
}

function closeNameModal() {
  nameModal.hidden = true;
}

nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  nameError.textContent = '';

  if (!NAME_RE.test(name)) {
    nameError.textContent = 'Use 2–20 letters, numbers, spaces, dots, hyphens or underscores.';
    return;
  }
  if (hasProfanity(name)) {
    nameError.textContent = 'That display name is not allowed.';
    return;
  }

  setPlayerName(name);
  paintNav();
  renderYou();
  renderBoard();
  closeNameModal();
  showToast('Display name saved ✅');
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#nameClose')) closeNameModal();
  if (e.target === nameModal) closeNameModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeNameModal();
});

/* ---------- LEADERBOARD ---------- */
async function getLeaderboard(gameId = GAME_ID, requestedLimit = 10) {
  if (!FIREBASE_READY || !db) return [];
  if (!GAME_ID_RE.test(gameId)) throw new Error('Invalid game ID.');

  const safeLimit = Math.min(Math.max(Number(requestedLimit) || 10, 1), 50);
  const snap = await withTimeout(
    getDocs(query(
      collection(db, 'scores'),
      where('game_id', '==', gameId),
      orderBy('score', 'desc'),
      limit(safeLimit)
    ))
  );

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function renderBoard(gameId = GAME_ID) {
  if (!FIREBASE_READY) {
    board.innerHTML = `<div class="board-empty">🔧 Firebase isn't configured yet.</div>`;
    $('statPlayers').textContent = '—';
    $('statHigh').textContent = '—';
    return;
  }

  board.innerHTML = `<div class="board-loading">Loading rankings…</div>`;

  try {
    const rows = await getLeaderboard(gameId, 10);

    if (!rows.length) {
      board.innerHTML = `<div class="board-empty">No scores yet. Be the first. 👑</div>`;
      $('statPlayers').textContent = '0';
      $('statHigh').textContent = '0';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const myName = getPlayerName();

    board.innerHTML = rows.map((entry, i) => {
      const name = String(entry.player_name || 'Guest');
      const isMe = name === myName;
      const rankClass = i < 3 ? 'rank gold' : 'rank';

      return `<div class="row ${isMe ? 'me' : ''}">
        <div class="${rankClass}">${medals[i] || '#' + (i + 1)}</div>
        <div class="row-name">
          <div class="avatar">${esc(initials(name))}</div>
          ${esc(name)}${isMe ? ' <span class="you-label">(you)</span>' : ''}
        </div>
        <div class="row-score">${Number(entry.score || 0).toLocaleString()}</div>
      </div>`;
    }).join('');

    $('statPlayers').textContent = rows.length.toLocaleString();
    $('statHigh').textContent = Number(rows[0].score || 0).toLocaleString();
  } catch (err) {
    console.error('[leaderboard]', err);
    board.innerHTML = `
      <div class="board-empty">
        Couldn't load the leaderboard.
        <br><span class="error-detail">${esc(err.message)}</span>
      </div>`;
  }
}

/* ---------- LOCAL PLAYER CARD ---------- */
function renderYou() {
  const name = getPlayerName();
  const progress = getProgress();
  const gameProgress = progress[GAME_ID] || {};
  const score = Number(gameProgress.highScore || 0);
  const games = Number(gameProgress.gamesPlayed || 0);

  youSection.hidden = false;
  $('youName').textContent = name;
  $('youScore').textContent = score.toLocaleString();
  $('youGames').textContent = games.toLocaleString();
  $('youRank').textContent = '—';
}

function recordLocalGame(gameId, result = {}) {
  const progress = getProgress();
  const current = progress[gameId] || {};
  const score = Number(result.score);

  progress[gameId] = {
    ...current,
    ...result,
    gamesPlayed: Number(current.gamesPlayed || 0) + 1,
    highScore: Number.isFinite(score) ? Math.max(Number(current.highScore || 0), score) : Number(current.highScore || 0),
    lastPlayedAt: Date.now()
  };

  writeJSON(PROGRESS_KEY, progress);
  renderYou();
}

/* ---------- SCORE SUBMISSION ---------- */
async function submitScore(gameId, score) {
  const playerName = getPlayerName();
  const numericScore = Number(score);

  if (!Number.isInteger(numericScore)) {
    throw new Error('Score must be an integer.');
  }

  validateScorePayload(gameId, playerName, numericScore);
  recordLocalGame(gameId, { score: numericScore });

  if (!FIREBASE_READY || !db) {
    showToast('Score saved on this device. Leaderboard is offline.');
    return { local: true, score: numericScore, player_name: playerName };
  }

  checkRateLimit();

  await withTimeout(addDoc(collection(db, 'scores'), {
    game_id: gameId,
    player_name: playerName,
    score: numericScore,
    timestamp: serverTimestamp()
  }));

  await renderBoard(gameId);
  showToast('Score submitted 🏆');
  return { local: false, score: numericScore, player_name: playerName };
}

/* ---------- GAME API ---------- */
// Games can use:
//   DL.submitScore('game-01', 1234)
//   DL.saveProgress('game-01', { level: 4, lives: 2 })
//   DL.getProgress('game-01')
//   DL.getSettings() / DL.setSettings({ sound: false })
//   DL.getPlayerName() / DL.setPlayerName('Guest_1234')
window.DL = {
  gameId: GAME_ID,
  get playerName() { return getPlayerName(); },
  getPlayerName,
  setPlayerName(name) {
    const clean = String(name ?? '').trim();
    if (!NAME_RE.test(clean) || hasProfanity(clean)) throw new Error('Invalid display name.');
    setPlayerName(clean);
    paintNav();
    renderYou();
  },
  getProgress(gameId = GAME_ID) {
    return getProgress()[gameId] || {};
  },
  saveProgress,
  getSettings,
  setSettings,
  getLeaderboard,
  submitScore,
  recordLocalGame
};

/* ---------- BOOT ---------- */
(function boot() {
  // Guest identity is generated locally. No login screen, no auth state, no accounts.
  getPlayerName();
  paintNav();
  renderYou();
  renderBoard();
  $('year').textContent = new Date().getFullYear();
})();
