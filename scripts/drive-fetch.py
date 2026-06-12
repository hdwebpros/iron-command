#!/usr/bin/env python3
"""Recursively download a public Google Drive folder via the embeddedfolderview
endpoint (no API key needed). Used to pull CC0 asset packs (Quaternius).

Usage: drive-fetch.py FOLDER_ID DEST_DIR [PATH_FILTER_REGEX]
Only paths (relative, e.g. "Characters/glTF/Soldier.gltf") matching the filter
are downloaded; folders are always traversed.
"""
import html
import os
import re
import sys
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def list_folder(folder_id):
    """Return [(id, title, is_folder)] for a public Drive folder."""
    page = fetch(f"https://drive.google.com/embeddedfolderview?id={folder_id}#list").decode("utf-8", "replace")
    entries = []
    for m in re.finditer(r'<div class="flip-entry" id="entry-([\w-]+)".*?flip-entry-title">([^<]*)<', page, re.S):
        eid, title = m.group(1), html.unescape(m.group(2)).strip()
        is_folder = f"/drive/folders/{eid}" in page
        entries.append((eid, title, is_folder))
    return entries


def download_file(file_id, dest):
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    data = fetch(url)
    # Large files return a virus-scan interstitial instead of content
    if data[:200].lstrip().startswith(b"<!DOCTYPE html") or data[:15] == b"<html":
        page = data.decode("utf-8", "replace")
        form = re.search(r'action="([^"]+)"', page)
        fields = dict(re.findall(r'name="([^"]+)" value="([^"]*)"', page))
        if not form:
            raise RuntimeError(f"no download form for {file_id}")
        qs = "&".join(f"{k}={urllib.parse.quote(v)}" for k, v in fields.items())
        data = fetch(html.unescape(form.group(1)) + "?" + qs)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    print(f"  {dest}  ({len(data) // 1024} KB)")


def walk(folder_id, dest, rel, pattern):
    for eid, title, is_folder in list_folder(folder_id):
        path = f"{rel}/{title}" if rel else title
        if is_folder:
            walk(eid, dest, path, pattern)
        elif pattern.search(path):
            target = os.path.join(dest, path)
            if os.path.exists(target):
                print(f"  {target}  (cached)")
            else:
                download_file(eid, target)


if __name__ == "__main__":
    folder, dest = sys.argv[1], sys.argv[2]
    pat = re.compile(sys.argv[3] if len(sys.argv) > 3 else ".", re.I)
    walk(folder, dest, "", pat)
