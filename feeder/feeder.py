#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-fireworks feeder — WASAPI loopback analyser that publishes audio events.

Captures a loopback device (usually your headphones so fireworks react to the
final post-8D sound) and writes a small JSON state file at ~30 fps:

  ~/.dsh/fireworks/state.json
  {
    "v": 1, "seq": 123, "ts": 1730560000.12,
    "meta": {"capture": "耳机 (Realtek(R) Audio)", "sr": 48000, "boot": 1730560000.0},
    "bass": -41.2, "treb": -55.8, "level": 0.13,
    "events": [
      {"id": 87, "t": 1730560000.05, "type": "kick", "s": 0.72},
      {"id": 88, "t": 1730560000.31, "type": "crackle", "s": 0.40}
    ]
  }

Events carry monotonic ids so the browser renderer can consume them exactly
once (no misses, no duplicates). meta.boot (process start epoch) lets the
renderer detect a feeder restart and reset its lastEventId — otherwise a
restarted feeder's low ids would be silently dropped by a long-lived page. Detection is the same recipe as the tkinter
fireworks: baseline EMA (a=0.02), bass onset -> "kick" (rocket), treble spike
-> "crackle" (white sparkle), each with its own refractory window.

Capture uses a BLOCKING reader thread (callback mode does not deliver WASAPI
loopback data reliably on this stack). The thread reopens the stream every
RECYCLE seconds and on any read error, so device changes and session
teardowns self-heal within a couple of seconds.

Usage:
  python feeder.py                          # default output loopback
  python feeder.py --capture-substr 耳机     # pick device by name substring
  python feeder.py --demo                   # synthetic pulses, no audio

Stop: create the file stop.flag next to state.json (stop_feeder.ps1 does it).
"""
import os
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import sys, math, time, json, argparse, tempfile, threading
from collections import deque
import numpy as np
import pyaudiowpatch as pw

N = 2048            # FFT window (samples)
WRITE_FPS = 30      # state file write rate
RECYCLE = 60.0      # proactive stream reopen period (reader thread)
RETRY_EVERY = 2.0   # pause between open attempts after a failure

ap = argparse.ArgumentParser()
ap.add_argument("--capture-substr", default="",
                help="empty = loopback of the system default output device")
ap.add_argument("--interval", type=float, default=1.0 / WRITE_FPS)
ap.add_argument("--demo", action="store_true",
                help="ignore audio, publish synthetic pulses (testing)")
a = ap.parse_args()

# ---------- paths (same resolution as the host plugin) ----------
def state_dir():
    home = os.environ.get("DSH_HOME")
    if not home:
        base = os.environ.get("USERPROFILE") or os.path.expanduser("~")
        home = os.path.join(base, ".dsh")
    return os.path.join(home, "fireworks")

SDIR = state_dir()
os.makedirs(SDIR, exist_ok=True)
STATE = os.path.join(SDIR, "state.json")
PIDF = os.path.join(SDIR, "feeder.pid")
STOPF = os.path.join(SDIR, "stop.flag")
for f in (STOPF,):
    if os.path.exists(f):
        try: os.remove(f)
        except OSError: pass
with open(PIDF, "w", encoding="ascii") as f:
    f.write(str(os.getpid()))

# ---------- shared capture state ----------
frames = deque(maxlen=80)
lock = threading.Lock()
aud = {}                      # {"p","stream","SR","CH","name"} — reader-thread only
demo = a.demo or a.capture_substr == "@demo"
BOOT_TS = round(time.time(), 3)   # process start epoch, for renderer restart detection
DEV_NAME = "demo" if demo else "waiting for device"
SR, CH = 48000, 2

# ---------- FFT band setup (depends on sample rate) ----------
freqs = None; win = None; BASS = None; TREB = None
def set_sr(sr):
    global freqs, win, BASS, TREB
    freqs = np.fft.rfftfreq(N, 1.0 / sr)
    win = np.hanning(N).astype(np.float32)
    BASS = (freqs >= 30) & (freqs <= 160)
    TREB = (freqs >= 3000) & (freqs <= 12000)
set_sr(SR)

def latest_block():
    with lock:
        if not frames:
            return None
        data = b"".join(frames)
        frames.clear()
    return data

def band_db(mag, mask):
    v = float(mag[mask].max()) if mask.any() and mag[mask].size else 0.0
    return 20.0 * math.log10(v + 1e-7)

# ---------- event detection state ----------
bass_base = -60.0
treb_base = -60.0
last_kick = 0.0
last_crackle = 0.0
event_id = 0
events = []          # last 8 events with monotonic ids
seq = 0

def record(kind, strength, now):
    global event_id
    event_id += 1
    events.append({"id": event_id, "t": now, "type": kind,
                   "s": round(strength, 3)})
    if len(events) > 8:
        del events[0]

def write_state(bass_db, treb_db, level, now):
    global seq
    seq += 1
    payload = {
        "v": 1, "seq": seq, "ts": round(now, 3),
        "meta": {"capture": aud.get("name", DEV_NAME),
                 "sr": aud.get("SR", SR), "demo": demo,
                 "boot": BOOT_TS},
        "bass": round(bass_db, 1), "treb": round(treb_db, 1),
        "level": round(level, 4),
        "events": events,
    }
    data = json.dumps(payload, ensure_ascii=False,
                      separators=(",", ":")).encode("utf-8")
    fd, tmp = tempfile.mkstemp(dir=SDIR, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, STATE)
    except OSError:
        try: os.remove(tmp)
        except OSError: pass

def clean_exit():
    try:
        with open(PIDF, "r", encoding="ascii") as f:
            if f.read().strip() == str(os.getpid()):
                os.remove(PIDF)
    except OSError:
        pass
    print("feeder bye", flush=True)

# ---------- reader thread (blocking reads, self-healing) ----------
stop_ev = threading.Event()

def close_stream():
    s = aud.pop("stream", None)
    if s is not None:
        try: s.stop_stream(); s.close()
        except Exception: pass
    p = aud.pop("p", None)
    if p is not None:
        try: p.terminate()
        except Exception: pass
    aud.clear()

def open_stream():
    """Open the loopback stream. Reader-thread only. True on success."""
    close_stream()
    try:
        p = pw.PyAudio()
        if a.capture_substr:
            dev = None
            for info in p.get_loopback_device_info_generator():
                if a.capture_substr.lower() in info["name"].lower():
                    dev = info
                    break
            if dev is None:
                p.terminate()
                print("no loopback device matches:", a.capture_substr,
                      "- retrying", flush=True)
                return False
        else:
            dev = p.get_default_wasapi_loopback()
        sr, ch = int(dev["defaultSampleRate"]), int(dev["maxInputChannels"])
        stream = p.open(format=pw.paInt16, channels=ch, rate=sr, input=True,
                        input_device_index=dev["index"], frames_per_buffer=1024)
        aud.update(p=p, stream=stream, SR=sr, CH=ch, name=dev["name"])
        set_sr(sr)
        print(f"capturing [{dev['index']}] {dev['name']}  {sr}Hz {ch}ch",
              flush=True)
        return True
    except Exception as e:
        print("open_stream failed:", e, flush=True)
        close_stream()
        return False

def reader():
    """Blocking loopback reader: reopen on error and every RECYCLE seconds."""
    while not stop_ev.is_set():
        if not open_stream():
            if stop_ev.wait(RETRY_EVERY):
                break
            continue
        t_open = time.time()
        chunks = 0
        t_stat = time.time()
        try:
            while not stop_ev.is_set():
                d = aud["stream"].read(1024, exception_on_overflow=False)
                chunks += 1
                with lock:
                    frames.append(d)
                if time.time() - t_stat >= 1.0:
                    print(f"reader: {chunks} chunks/s", flush=True)
                    chunks = 0
                    t_stat = time.time()
                if time.time() - t_open > RECYCLE:
                    break
        except Exception as e:
            print("read error:", e, flush=True)
        finally:
            close_stream()
        if stop_ev.wait(RETRY_EVERY):
            break

if not demo:
    threading.Thread(target=reader, daemon=True,
                     name="fw-reader").start()
else:
    print("demo mode: synthetic bass pulses", flush=True)

# ---------- main loop ----------
next_write = time.time()
pcm_tail = np.zeros(0, np.float32)   # rolling window for the FFT (always >= N)
# window accumulators for the state file (mean level / peak bands since last write)
acc_n = 0
acc_level_sq = 0.0
win_bass = -70.0
win_treb = -70.0
try:
    while True:
        now = time.time()
        if os.path.exists(STOPF):
            break

        bass_db = treb_db = -70.0
        level = 0.0
        got = False
        if demo:
            ph = now % 1.3
            bass_db = -28 + 20 * math.exp(-(ph / 0.09) ** 2)
            treb_db = -40 + 8 * math.exp(-((ph - 0.65) / 0.05) ** 2) \
                + float(np.random.uniform(-2, 2))
            level = 0.1 + 0.05 * math.exp(-(ph / 0.3) ** 2)
            got = True
        else:
            d = latest_block()
            if d is not None:
                got = True
                try:
                    x = np.frombuffer(d, np.int16).astype(np.float32)
                    ch_now = aud.get("CH", CH)
                    x = x.reshape(-1, ch_now).mean(axis=1) / 32768.0
                    level = float(np.sqrt(np.mean(x * x)))
                    # rolling FFT window: partial chunks accumulate, so the
                    # spectrum is computed every spin once the buffer is full
                    pcm_tail = np.concatenate([pcm_tail, x])[-N:]
                    if len(pcm_tail) >= N:
                        mag = np.abs(np.fft.rfft(pcm_tail * win)) / (N / 4.0)
                        bass_db = band_db(mag, BASS)
                        treb_db = band_db(mag, TREB)
                except Exception:
                    pass
        if got:
            # baseline EMA follows real audio only (empty spins must not
            # drag the floor down, or every hit would read as max strength)
            bass_base += (bass_db - bass_base) * 0.020
            treb_base += (treb_db - treb_base) * 0.020
            # window stats for the state file
            acc_n += 1
            acc_level_sq += level * level
            win_bass = max(win_bass, bass_db)
            win_treb = max(win_treb, treb_db)

        # --- onsets (same thresholds as the tkinter show) ---
        if bass_db > bass_base + 5.5 and bass_db > -50 \
                and now - last_kick > 0.55:
            s = min(1.0, max(0.15, (bass_db - bass_base - 3.0) / 14.0))
            record("kick", s, now)
            last_kick = now
        if treb_db > treb_base + 7.0 and treb_db > -46 \
                and now - last_crackle > 0.45:
            s = min(1.0, max(0.3, (treb_db - treb_base - 4.0) / 12.0))
            record("crackle", s, now)
            last_crackle = now

        if now >= next_write:
            if acc_n:
                write_state(win_bass, win_treb,
                            math.sqrt(acc_level_sq / acc_n), now)
            else:
                write_state(-70.0, -70.0, 0.0, now)
            acc_n = 0
            acc_level_sq = 0.0
            win_bass = -70.0
            win_treb = -70.0
            next_write = max(next_write + a.interval, now)
        time.sleep(0.004)
finally:
    stop_ev.set()
    clean_exit()
