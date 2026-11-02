# dsh-fireworks

Audio-driven fireworks background skin for DeepSeek Harness — bass drum hits
launch rockets, strong kicks burst into hearts, hi-hats crackle white, and a
quiet night sky with stars and a crescent moon fills the rest.

```
┌────────────────────────────────────────────────────────────┐
│  DSH app (glass shell)                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ fireworks iframe (z-index 0, canvas 2D, 60 fps)      │  │
│  │   ↑ polls /dsh-fireworks/state.json (30 Hz)          │  │
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
# then add "dsh-fireworks" to dsh.profile.bundles in the profile package.json
```

## Run

```powershell
feeder\start_feeder.ps1            # capture the headphones (default)
feeder\stop_feeder.ps1
```

Then reload the DSH page — a spark button appears next to the (optional)
ocean-skin button, with glass opacity / firework density / on-off settings.

## Files

| File | Purpose |
|---|---|
| `plugin/index.js` | host plugin: serves the renderer and bridges `state.json` |
| `plugin/client.js` | client injection: iframe + glass + button/panel |
| `native-dist/fireworks.html/js` | the canvas show (star field, rockets, hearts) |
| `feeder/feeder.py` | loopback analyser publishing onset events at 30 fps |
| `feeder/start_feeder.ps1` / `stop_feeder.ps1` | feeder lifecycle |

## Notes

- State file: `~/.dsh/fireworks/state.json` (override `DSH_HOME`).
- The feeder captures the **final** audio (headphones loopback), so fireworks
  react to the post-8D sound when the 8D engine is running.
- Panel styling adapted from open-sea-skin (MIT).
