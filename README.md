# Climbing log

A phone-first training log: what to do next, strength trends, climb list progress and the plan.
It is a static site (no build step, no dependencies). Everything it shows comes from `data.json`.

## Updating
After a session, edit `data.json` and push. GitHub Pages redeploys in about a minute.

- `sessions`: one row per session. `type` is Finger, Board, Pull, Weakness or Stretching. `readiness` is 1 to 5 or null.
- `lists[].climbs[]`: set `sent` to true, add `tries` (and optionally `dateSent`).
- `strength`: add a row per Tindeq test (`type` is "20mm half crimp" or "Pinch block", kg values, optional `time` as "HH:MM").
- `updated`: today's date.

## Do-next logic (app.js, `recommend`)
- Finger and Board need 2 days between them.
- A session is done for the week if it was logged in the last 7 days at its weekly target.
- Day after Finger or Board: Weakness (light day). Otherwise the most overdue open session.
- Readiness 1 or 2 (tapped on the Today screen) makes it a light day.
- If a training session is already logged today, the suggestion is for tomorrow.

## Testing
`python3 -m http.server`, then open `/?today=2026-11-17` to pretend it is another day.
