# Domain League — Neon Run

Accountless arcade architecture. Game 01 is **Neon Run**, an endless square-jumping runner inspired by arcade obstacle runners and rhythm platformers.

## Player state
- Guest display name: `localStorage`
- Personal best: `localStorage`
- Settings/progress can be stored locally as the game expands
- No login, signup, password, session, JWT, or user profile

## Scores
Scores are flat Firestore records in `scores`:
`game_id`, `player_name`, `score`, `timestamp`.

Client validation includes name filtering and a basic local submission rate limit. This is not anti-cheat: a browser-controlled client cannot make competitive scores fully trustworthy. For serious competition, verify score claims server-side.
