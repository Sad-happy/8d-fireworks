# 8d-fireworks

8D audio-reactive fireworks for DeepSeek Harness — the sky lives above the chat
window and answers what your headphones are playing: bass hits launch rockets,
kicks burst into peonies, hearts, rings and palms, hi-hats crackle, and a quiet
star field with the real moon phase fills the gaps.

Show highlights:

- 12 shell types (peony, chrysanthemum, willow, ring, heart, crossette, palm,
  glitter, spiral, double, pistil, strobe) and multi-break grand shells.
- The moon follows the real synodic month (`0` = new, `.5` = full): terminator,
  earthshine and craters track today's date. The settings panel can also pin a
  phase by hand (moon slider + "Follow the real date" switch), and `?moon=0.25`
  freezes a phase in the URL for testing.
- 170 stars with a milky-way band, cross flares and twinkle, plus occasional
  meteors.

> Renamed from `dsh-fireworks` to `8d-fireworks` (v0.2) so it no longer shares a
> name/description with other marketplace plugins.


```
┌────────────────────────────────────────────────────────────┐
│  DSH app (glass shell)                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ fireworks iframe (z-index 0, canvas 2D, 60 fps)      │  │
│  │   ↑ polls /8d-fireworks/state.json (30 Hz)          │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
        ↑ HTTP (same origin)            ↑ reads
  [host plugin: webServer route]   [state.json]
                                          ↑ writes 30 fps
                                  [feeder.py — WASAPI loopback of your
                                   headphones → bass/treble onset events]
```

## Install

```powershell
# from the profile that runs the desktop app
corepack pnpm@11.28.5 --dir <profile-dir> add link:<path-to-this-repo>
# then add "8d-fireworks" to dsh.profile.bundles in the profile package.json
```

## Run

```powershell
feeder\start_feeder.ps1            # capture the headphones (default)
feeder\stop_feeder.ps1
```

Then reload the DSH page — a spark button appears next to the (optional)
ocean-skin button. The panel has glass opacity, firework density, moon phase
(auto or manual) and an on/off switch.

## Files

| File | Purpose |
|---|---|
| `plugin/index.js` | host plugin: serves the renderer and bridges `state.json` |
| `plugin/client.js` | client injection: iframe + glass + button/panel |
| `native-dist/fireworks.html/js` | the canvas show (star field, real moon phase, shells, meteors) |
| `feeder/feeder.py` | loopback analyser publishing onset events at 30 fps |
| `feeder/start_feeder.ps1` / `stop_feeder.ps1` | feeder lifecycle |

## Notes

- State file: `~/.dsh/fireworks/state.json` (override `DSH_HOME`).
- The feeder captures the **final** audio (headphones loopback), so fireworks
  react to the post-8D sound when the 8D engine is running.
- Panel styling adapted from open-sea-skin (MIT).
