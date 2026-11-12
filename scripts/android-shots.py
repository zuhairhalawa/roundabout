#!/usr/bin/env python3
"""Drives the Android app on an emulator or a phone through adb, checks what is on screen and
takes screenshots. Used by the GitHub Actions workflow; it also works with a phone on a cable.

    python3 scripts/android-shots.py [output folder]

It finds things by the words on screen (through uiautomator), not by position. If the build has
its Firebase settings, it also asks for a word and waits for the tiles.
"""
import os
import re
import subprocess
import sys
import time

OUT = sys.argv[1] if len(sys.argv) > 1 else "android-shots"
APP = "app.roundabout.words"
os.makedirs(OUT, exist_ok=True)
results = []


def adb(*args, binary=False):
    done = subprocess.run(["adb", *args], capture_output=True, timeout=180)
    return done.stdout if binary else done.stdout.decode("utf8", "replace")


def words(node):
    return (node.get("text", "") + " " + node.get("content-desc", "")).strip()


def centre(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node["bounds"]))
    return str((x1 + x2) // 2), str((y1 + y2) // 2)


def nodes():
    found = []
    for _ in range(4):
        adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
        xml = adb("shell", "cat", "/sdcard/ui.xml")
        found = [dict(re.findall(r'([\w-]+)="([^"]*)"', tag)) for tag in re.findall(r"<node [^>]*>", xml)]
        # On a slow emulator the system sometimes says that one of its own apps (the launcher,
        # the system screen) is not responding, and that notice covers the app. Tap "Wait".
        wait = next((n for n in found if words(n) == "Wait"), None)
        if wait is None or not any("responding" in words(n) for n in found):
            break
        print("NOTE the emulator said one of its own apps is not responding; tapped Wait.", flush=True)
        adb("shell", "input", "tap", *centre(wait))
        time.sleep(3)
    return found


def on_screen():
    return [words(n) for n in nodes() if words(n)]


def find(text, tries=20):
    for _ in range(tries):
        for n in nodes():
            if text in words(n):
                return n
        time.sleep(1)
    return None


def tap(text):
    node = find(text)
    if not node:
        return False
    adb("shell", "input", "tap", *centre(node))
    time.sleep(1.2)
    return True


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
check("a clue can be typed", find("thing for the rain", 5) is not None)
shot("3-typed")

if not configured:
    print("NOTE this build has no Firebase settings, so no word is asked for.", flush=True)
else:
    check("the find button is tapped", tap("Find the word"))
    tile = find("Tap to hear it", 90)
    time.sleep(2)
    shot("4-answer")
    texts = on_screen()
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
