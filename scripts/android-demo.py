#!/usr/bin/env python3
"""Records a short walkthrough of the Android app, for the demo video: describe a word, tap a
tile, ask why, tap hints for another word, then private mode. Works on an emulator (GitHub
Actions) or on a phone with a cable.

    python3 scripts/android-demo.py [output folder]

It writes roundabout-android.mp4 and a few still frames. It never fails the build: a demo that
could not be recorded is a note in the log, not an error.
"""
import os
import re
import subprocess
import sys
import time

from adbui import APP, adb, centre, find, nodes, scroll_to, tap, tap_node, to_top, words

OUT = sys.argv[1] if len(sys.argv) > 1 else "android-demo"
REMOTE = "/sdcard/roundabout-android.mp4"
os.makedirs(OUT, exist_ok=True)


def note(text):
    print("DEMO " + text, flush=True)


def still(name):
    with open(os.path.join(OUT, name + ".png"), "wb") as f:
        f.write(adb("exec-out", "screencap", "-p", binary=True))


def type_slowly(text):
    for word in text.split(" "):
        adb("shell", "input", "text", word + "%s")
        time.sleep(0.2)


def answer(seconds=75):
    """Wait for word tiles, or for the app to say why there are none. Returns what happened."""
    for _ in range(seconds):
        seen = nodes()
        tiles = [words(n).split(",")[0] for n in seen if "Tap to hear it" in words(n)]
        if tiles:
            return "tiles: " + ", ".join(tiles)
        refused = next((words(n) for n in seen if re.search(r"did not work|resting|No word came back|Private mode needs", words(n))), "")
        if refused:
            return "the app says: " + refused
        time.sleep(1)
    return "nothing came back"


def walkthrough():
    adb("shell", "am", "start", "-W", "-n", APP + "/.MainActivity")
    if not find("What is it like?", 60):
        note("the app did not open")
        return
    time.sleep(3)

    # 1. Describe it.
    field = next((n for n in nodes() if n.get("class", "").endswith("EditText")), None)
    if field:
        tap_node(field, 1)
        type_slowly("thing for the rain over your head")
        adb("shell", "input", "keyevent", "111")  # hide the keyboard
        time.sleep(1)
    tap("Find the word", after=0.5)
    note("describe: " + answer())
    time.sleep(4)
    still("1-described")
    if tap("umbrella,", tries=3, after=2.5):  # the tile is chosen and spoken
        still("2-chosen")
    if tap("Why?", tries=3, after=4):
        still("3-why")
        tap("OK", tries=3)

    # 2. Tap hints: a person, a health worker, teeth.
    to_top()
    tap("Tap hints", after=1.5)
    tap("a person", after=1.2)
    tap("a health worker", after=1.2)
    node = scroll_to("teeth")
    if node:
        tap_node(node, 1.5)
    node = scroll_to("Find the word")
    if node:
        tap_node(node, 0.5)
    note("hints: " + answer())
    time.sleep(4)
    still("4-hints")

    # 3. Private mode: on a phone with no on-device model the app says so, and sends nothing.
    switch = None
    for _ in range(5):
        switch = next((n for n in nodes() if n.get("checkable") == "true"), None)
        if switch:
            break
        adb("shell", "input", "swipe", "540", "1500", "540", "800", "350")
        time.sleep(1)
    if switch:
        tap_node(switch, 1.5)
        to_top(1)
        node = find("Find the word", 3) or scroll_to("Find the word")
        if node:
            tap_node(node, 0.5)
        note("private mode: " + answer(20))
        time.sleep(4)
        still("5-private")


adb("shell", "settings", "put", "system", "show_touches", "1")
adb("shell", "am", "force-stop", APP)
adb("shell", "rm", "-f", REMOTE)
recorder = subprocess.Popen(["adb", "shell", "screenrecord", "--time-limit", "175", "--bit-rate", "6000000", REMOTE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
started = time.time()
try:
    walkthrough()
except Exception as e:  # never fail the build for the demo
    note("stopped early: " + str(e)[:200])
adb("shell", "pkill", "-2", "screenrecord")  # ask the recorder to finish the file
try:
    recorder.wait(timeout=30)
except subprocess.TimeoutExpired:
    recorder.kill()
time.sleep(2)
adb("shell", "settings", "put", "system", "show_touches", "0")
adb("pull", REMOTE, os.path.join(OUT, "roundabout-android.mp4"))
path = os.path.join(OUT, "roundabout-android.mp4")
size = os.path.getsize(path) if os.path.exists(path) else 0
note(f"walkthrough took {time.time() - started:.0f} s; recording is {size // 1024} KB" + ("" if size > 50_000 else " (too small: the screen could not be recorded here)"))
sys.exit(0)
