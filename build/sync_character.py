"""Copy the ForeverAtlas addon's SavedVariables into site/character.js, so the page picks up your
character (faction, level, class, hearth, known flight points) the next time it is opened.
Run after logging out or /reload in game:  python3 build/sync_character.py"""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "..", "site", "character.js")
files = glob.glob("/Applications/World of Warcraft/_forever_/WTF/Account/*/SavedVariables/ForeverAtlas.lua")
if not files:
    open(OUT, "w").write("window.FA_CHARACTER = null;\n")
    sys.exit("No ForeverAtlas.lua yet. Install the addon (addon/ForeverAtlas), log in, open a flight master's map, then /reload or log out.")
f = max(files, key=os.path.getmtime)
text = open(f, encoding="utf-8", errors="replace").read()
open(OUT, "w").write(f"window.FA_CHARACTER = {json.dumps(text)};\nwindow.FA_CHARACTER_TIME = {int(os.path.getmtime(f))};\n")
print(f"copied {f} ({len(text)} bytes) -> site/character.js. Reload the page.")
