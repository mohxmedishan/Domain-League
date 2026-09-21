# 🎮 Domain League

A tiny accountless arcade. Small games. Big bragging rights.

## Architecture

- Vanilla HTML/CSS/JS, no build step.
- **No accounts or authentication.**
- Player display name, game progress, settings, and local preferences use `localStorage`.
- Public high scores are stored as flat Firestore `scores` records:
  - `game_id`
  - `player_name`
  - `score`
  - `timestamp`
- Leaderboards query scores by `game_id` and sort by `score` descending.
- Client-side score/name validation, profanity filtering, and submission rate limiting are included.
- Firestore rules reject malformed score records and prevent updates/deletes.

## Game API

```js
DL.submitScore('game-01', 1234);
DL.saveProgress('game-01', { level: 4, lives: 2 });
DL.getProgress('game-01');
DL.getSettings();
DL.setSettings({ sound: false });
DL.getPlayerName();
DL.setPlayerName('Guest_1234');
DL.getLeaderboard('game-01', 10);
```

`DL.submitScore()` accepts the anonymous payload conceptually as:

```js
{ game_id, player_name, score }
```

The Firestore layer adds `timestamp` using `serverTimestamp()`.

## Important security note

The client-side rate limiter and validation improve the player experience, but **they are not a secure anti-cheat system** because an anonymous browser can be modified.

The included Firestore rules enforce the record shape and score bounds. For serious competitive integrity, move score submission behind a trusted server/Cloud Function and validate the score against the game's actual server-verifiable state.

## Firebase setup

1. Keep your existing `firebase-config.js`.
2. Deploy `firestore.rules` to the Firebase project.
3. Create/use the `scores` collection. It is created automatically on the first score submission.
4. If Firebase asks for a composite index for `game_id + score`, create the suggested index.

There are deliberately no Firebase Auth dependencies and no user/account collection writes in this version.
