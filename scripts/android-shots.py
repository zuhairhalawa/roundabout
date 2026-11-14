#!/usr/bin/env python3
"""Drives the Android app on an emulator or a phone through adb, checks what is on screen and
takes screenshots. Used by the GitHub Actions workflow; it also works with a phone on a cable.

    python3 scripts/android-shots.py [output folder]

It finds things by the words on screen (through uiautomator), not by position. If the build has
its Firebase settings, it also asks for a word and waits for the tiles.
"""
import os
import re
import sys
import time

from adbui import APP, adb, centre, find, nodes, on_screen, tap, words

OUT = sys.argv[1] if len(sys.argv) > 1 else "android-shots"
os.makedirs(OUT, exist_ok=True)
results = []


def shot(name):
    with open(os.path.join(OUT, name + ".png"), "wb") as f:
        f.write(adb("exec-out", "screencap", "-p", binary=True))


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (" - " + str(detail)[:200] if detail else ""), flush=True)


adb("shell", "am", "start", "-W", "-n", APP + "/.MainActivity")
opened = find("What is it like?", 60) is not None
check("the app opens", opened)
time.sleep(3)
texts = on_screen()
shot("1-start")
if not opened:
    print("on screen instead: " + " | ".join(texts)[:400], flush=True)
    sys.exit(1)
configured = not any("Not set up" in t for t in texts)
pill = next((t for t in texts if re.search(r"this phone|the cloud|Offline|Not set up", t)), "")
check("the pill at the top says where answers come from", bool(pill), pill)

check("the hints open", tap("Tap hints") and find("It is") is not None)
check("picking a group shows its questions", tap("a thing") and find("You find it") is not None)
check("a hint can be picked", tap("in the kitchen"))
shot("2-hints")

check("the describe box opens", tap("Describe it") and find("Any words will do") is not None)
field = next((n for n in nodes() if n.get("class", "").endswith("EditText")), None)
if field:
    adb("shell", "input", "tap", *centre(field))
    time.sleep(1)
    adb("shell", "input", "text", "thing%sfor%sthe%srain%sover%syour%shead")
    time.sleep(1)
    adb("shell", "input", "keyevent", "111")  # hide the keyboard
    time.sleep(1)
check("a clue can be typed", find("thing for the rain", 20) is not None)
shot("3-typed")

if not configured:
    print("NOTE this build has no Firebase settings, so no word is asked for.", flush=True)
else:
    # The free cloud tier is sometimes busy, so a refused request is tried again, up to three times.
    tile, refused = None, ""
    for attempt in range(3):
        tapped = tap("Find the word")
        if attempt == 0:
            check("the find button is tapped", tapped)
        for _ in range(90):
            seen = nodes()
            tile = next((n for n in seen if "Tap to hear it" in words(n)), None)
            refused = next((words(n) for n in seen if re.search(r"did not work|resting|No word came back", words(n))), "")
            if tile or refused:
                break
            time.sleep(1)
        if tile:
            break
        print(f"NOTE try {attempt + 1}: no tiles. The app says: {refused or '(nothing yet)'}", flush=True)
        time.sleep(25)
    if tile is None:
        # Say why, from the app's own log (keys and tokens are never printed).
        log = adb("logcat", "-d", "-t", "600")
        for line in [l for l in log.splitlines() if re.search(r"Roundabout|FirebaseAI|GenerativeModel|quota|RESOURCE_EXHAUSTED", l) and "secret" not in l.lower()][-12:]:
            print("LOG " + re.sub(r"AIza[0-9A-Za-z_-]{20,}", "<api-key>", line)[:300], flush=True)
    if tile is None and "resting" in refused:
        shot("4-cloud-resting")
        print("SKIPPED the word tiles: every free cloud model said that its quota is used up, and the app said so. The daily quota resets at midnight Pacific time.", flush=True)
        print(f"\n{sum(results)}/{len(results)} passed, the cloud answer was skipped", flush=True)
        sys.exit(0 if all(results) else 1)
    time.sleep(3)  # the app scrolls the answer into view
    shot("4-answer")
    texts = on_screen()
    if not any(t.startswith("Found ") for t in texts):
        # The line under the tiles may still be below the fold on a small screen: scroll down.
        adb("shell", "input", "swipe", "540", "1700", "540", "700", "400")
        time.sleep(1.5)
        texts += [t for t in on_screen() if t not in texts]
        shot("4-answer-lower")
    tiles = [t.split(",")[0] for t in texts if "Tap to hear it" in t]
    source = next((t for t in texts if t.startswith("Found ")), "")
    note = next((t for t in texts if "did not work" in t or "resting" in t or "debug token" in t), "")
    check("word tiles come back", tile is not None, ", ".join(tiles) or note)
    check("the line under the tiles says which side answered", bool(source), source)
    if tile:
        check("umbrella is offered", any("umbrella" in t.lower() for t in tiles), ", ".join(tiles))
        tap("Tap to hear it")
        shot("5-chosen")

print(f"\n{sum(results)}/{len(results)} passed", flush=True)
sys.exit(0 if all(results) else 1)
