# Climbing log

A phone-first training log: what to do next, strength trends, climb list progress and the plan.
It is a static site (no build step, no dependencies). Everything it shows comes from `data.json`.

## Updating
Two ways, both write the same `data.json` (the single source of truth):

1. From the site. Log a session, add a Tindeq test (CSV import or by hand), mark climbs sent or add climbs.
   Plan, Saving: paste a fine-grained GitHub token (this repo only, Contents read and write). It is kept in the
   browser's localStorage and never committed. Each change becomes a commit to `data.json`; if the phone is offline,
   changes wait in a queue and upload later. Changes are idempotent ops, so a retry never double-adds.
2. Send Claude board screenshots or a CSV; Claude edits `data.json` and pushes. Keep `rev` going up by one per commit.

GitHub Pages redeploys in about a minute.

- `rev`: integer, +1 per commit. The site prefers its own just-saved copy until the deployed file catches up.
- `sessions`: one row per session, each with an `id`. `type` is Finger, Board, Pull, Weakness or Stretching. `readiness` is 1 to 5 or null.
- `lists[].climbs[]`: set `sent` to true, add `tries` (and optionally `dateSent`).
- `strength`: add a row per Tindeq test (with an `id`) (`type` is "20mm half crimp" or "Pinch block", kg values, optional `time` as "HH:MM").
- `updated`: today's date.

## Do-next logic (app.js, `recommend`)
- Finger and Board need 2 days between them.
- A session is done for the week if it was logged in the last 7 days at its weekly target.
- Day after Finger or Board: Weakness (light day). Otherwise the most overdue open session.
- Readiness 1 or 2 (tapped on the Today screen) makes it a light day.
- If a training session is already logged today, the suggestion is for tomorrow.

## Testing
`python3 -m http.server`, then open `/?today=2026-11-17` to pretend it is another day.

## Days and groups
`groups` in `data.json` lists which tasks share a day, for example `[["Finger","Pull"],["Board"],["Weakness"]]`.
They stay separate tasks: logging one never ticks the other. The Today suggestion treats a group as one day, and a
group waits if its heavy member (Finger) is inside the 2-day gap after Board.

## Workouts
`workouts.<Session>.exercises[]` drive the screens opened from the Plan tab. An exercise has `sets`, `reps`, `unit`,
`load`, `how` and `timers`. An exercise with `variants` is a "pick one" (Pull's main lift); the session title is
prefilled with the variant name so the next visit can show what was done last.

## Climb days and single exercises
- `Climb` is a session type for a normal climbing session (a tired day instead of Board). It counts as a training day
  in the load figures and the calendar, is not heavy, and ticks off no weekly target.
- `parts[]` holds exercises ticked off on their own: `{id, date, session, exercise, name, detail?}`. Ops: `addPart`,
  `deletePart`. Parts from the last 7 days count towards that session's week (`partsFor`). Ticking every exercise in a
  workout makes `statusFor` return done, as if the session had been logged. Logging the whole session still works as before.
