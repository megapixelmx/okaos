# OKAOs Beatmap Conversion Spec (osu! → OKAOs JSON)

You are converting an osu!mania (or osu!std) beatmap into the note format used by the OKAOs rhythm engine (`play/run.html`). Follow every rule below exactly. Do not add fields, do not guess timing, do not invent columns.

## 1. Output file structure

Produce ONE JSON object with this exact shape:

```json
{
  "id": "m3",
  "nombre": "Song Title",
  "autor": "Original Artist",
  "creador": "Chart Creator",
  "dificultad": "Hard",
  "bpm": 130,
  "velocidad": 1.3,
  "duracion": "02:35",
  "puntos": 42200,
  "fondo": "../img/fn/f8.jpeg",
  "video": "../video/v1.mp4",
  "audio": "../music/m1.ogg",
  "map": "../mapped/m1.json",
  "notes": [
    { "time": 484, "col": 0 },
    { "time": 945, "col": 1 }
  ]
}
```

- `notes` is the ONLY part derived from the osu! beatmap. Every other field is metadata copied from the song info you're given (title, artist, mapper, difficulty name, BPM, file paths). If a metadata value is not provided to you, leave the field out rather than inventing one.
- `notes` must contain ONLY the two keys `time` and `col` per entry. No hitsounds, no object type, no endTime, no extra data of any kind.

## 2. `time` — the field that most often breaks the engine

- `time` is an integer in **milliseconds**, measured from the exact start (0:00) of the actual audio file referenced in `"audio"` — NOT from osu!'s internal editor offset.
- osu! beatmaps can include audio lead-in, a nonzero `AudioLeadIn`, or a preview/offset value in the `[General]` section. **Strip all of that out.** The OKAOs engine starts its clock the instant `bgMusic` begins playing, so `time: 0` must correspond to the first sample of the exported audio file, not the beatmap editor's internal timeline.
- If the osu! hit object time and the shipped audio file do not start at the same point (e.g., the mp3 used by OKAOs was trimmed differently than the one used in osu!), you must recompute every `time` value by adding/subtracting the exact offset difference. This mismatch is the single most common reason notes appear to spawn at the wrong moment — it is a timing/offset bug, not a bug in the OKAOs engine.
- All `time` values must be non-negative integers, sorted in ascending order.
- Do not output floating point timestamps. Round to the nearest millisecond.

## 3. `col` — column mapping (0 to 3 only)

The OKAOs engine only supports **4 columns**, indexed `0`, `1`, `2`, `3`. There is no 5K/6K/7K support.

| col | Direction | Default key |
|---|---|---|
| 0 | Left  | D |
| 1 | Up    | F |
| 2 | Down  | J |
| 3 | Right | K |

- If the source is a 4K osu!mania chart, map its lanes 1→2→3→4 (left to right) directly to `col` 0→1→2→3 unless told otherwise.
- If the source has a different key count (5K, 6K, 7K, or osu!std), you must remap or reduce it to exactly 4 lanes. Never output a `col` value outside `0-3` — the engine will misrender or silently drop anything else.
- Every note needs exactly one `col`. Do not split one hit object into multiple simultaneous notes unless the original chart genuinely has a chord (two or more different columns hit at the same `time` — that's allowed and intentional).

## 4. Hold / long notes are NOT supported

The OKAOs engine only renders single tap notes. If the osu! beatmap contains hold notes (osu!mania type `128`, or sliders in osu!std):

- Convert the hold to a single tap note using only its **start time**.
- Discard the `endTime` entirely. Do not create a second note for the release.

## 5. What NOT to include

- No `hitSound`, `hitSample`, `type`, `endTime`, `newCombo`, or any other osu!-specific field.
- No duplicate notes with identical `time` AND `col`.
- No comments inside the JSON (JSON does not support comments — output must be strictly valid, parseable JSON).

## 6. `velocidad` (scroll speed) vs. BPM — do not confuse these

- `bpm` is just metadata (informational), copied from the song.
- `velocidad` is a separate multiplier that controls how fast notes visually travel from spawn to the receptor. It does **not** change audio playback speed and is unrelated to how `time` values are calculated.
- Typical safe range: `0.8` to `2.5`. Do not set extreme values — the engine clamps travel time internally, but a sane value keeps the chart legible.

## 7. Final self-check before returning the JSON

Confirm all of the following are true:
- [ ] `notes` is sorted ascending by `time`
- [ ] Every `time` is a non-negative integer in milliseconds, aligned to the actual shipped audio file (not the osu! editor offset)
- [ ] Every `col` is an integer `0`, `1`, `2`, or `3` — nothing else
- [ ] No hold/long notes remain — only single tap entries
- [ ] No extra keys exist anywhere inside a note object besides `time` and `col`
- [ ] The full file is valid JSON with the top-level structure shown in section 1
