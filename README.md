# Death Loop: Your Past Hunts You

A time-loop survival game in the browser. Every time you hit a hazard, your past run comes back as a ghost clone that replays your moves, shoots at you, then hunts you down.

**Play online: https://abdoulaye-26.github.io/YourPastHunts/**

## How to play

Or play locally: open `index.html` in a modern browser (Chrome, Firefox, Edge) and click **Start Game** or press **Enter**.

If audio doesn't play when opening the file directly, serve the folder instead:

```
npx serve .
```

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrow keys | Move |
| Space | Shoot |
| Shift | Dash (short burst, 0.8 s cooldown) |
| P / Esc | Pause |
| M | Mute |
| Enter | Start / play again |

On touch screens, an on-screen joystick (bottom left) and **Fire** / **Dash** buttons (bottom right) appear automatically.

## Rules

- Reach the **green zone** before the timer (10 s) runs out. Each zone is worth 10 points and resets the timer.
- You have **5 lives**. You lose one when you:
  - get hit by a clone's bullet,
  - touch a clone,
  - touch a red hazard. This also loops you: the last 10 seconds of your run become a ghost clone and you respawn at another corner.
- After a hit you are invulnerable for 1 second.
- Shooting a clone destroys it for 5 points.
- Every 20 seconds the level goes up: more clones are allowed (up to 6), clones hunt faster and moving hazards speed up.
- The game ends when you run out of lives or time. Your best score is saved in the browser.

## Project structure

- `index.html`: page layout, HUD and overlays
- `styles.css`: styling
- `game.js`: game logic and canvas rendering (vanilla JavaScript, no dependencies)
- `media/`: music and sound effects

Built during an online hackathon (April 2026).
