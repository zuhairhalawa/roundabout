"""Small helpers for driving the Android app through adb: find things by the words on screen
(through uiautomator), tap them, scroll to them. Used by android-shots.py and android-demo.py.
"""
import re
import subprocess
import time

APP = "app.roundabout.words"


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


def tap_node(node, after=1.2):
    adb("shell", "input", "tap", *centre(node))
    time.sleep(after)


def tap(text, tries=20, after=1.2):
    node = find(text, tries)
    if not node:
        return False
    tap_node(node, after)
    return True


def scroll_to(text, swipes=6):
    """Scroll down the page until the words are on screen. Returns the node, or None."""
    for _ in range(swipes + 1):
        node = find(text, 1)
        if node:
            return node
        adb("shell", "input", "swipe", "540", "1500", "540", "800", "350")
        time.sleep(1)
    return None


def to_top(swipes=3):
    for _ in range(swipes):
        adb("shell", "input", "swipe", "540", "700", "540", "1900", "250")
        time.sleep(0.6)
