#!/usr/bin/env python3
"""Snapshot and rollback manager for Artisan 3D Studio.

Guarantees safety and instant rollback before and after refactors.
"""
import argparse
import os
import shutil
import sys
import time
import zipfile

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(HERE)
SNAPSHOT_DIR = os.path.join(APP_ROOT, ".snapshots")

IGNORED_DIRS = {".git", "node_modules", "dist", ".snapshots"}


def create_snapshot(tag=None):
    if not tag:
        tag = f"snapshot_{int(time.time())}"
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    zip_path = os.path.join(SNAPSHOT_DIR, f"{tag}.zip")
    
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(APP_ROOT):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, APP_ROOT)
                zf.write(full_path, rel_path)
                count += 1
                
    size_mb = os.path.getsize(zip_path) / (1024 * 1024)
    print(f"✓ Snapshot created: {tag} ({count} files, {size_mb:.2f} MB)")
    print(f"  Archive: {zip_path}")
    return zip_path


def list_snapshots():
    if not os.path.exists(SNAPSHOT_DIR):
        print("No snapshots found.")
        return
    files = sorted(os.listdir(SNAPSHOT_DIR), reverse=True)
    if not files:
        print("No snapshots found.")
        return
    print("Available snapshots:")
    for f in files:
        if f.endswith(".zip"):
            tag = f[:-4]
            p = os.path.join(SNAPSHOT_DIR, f)
            mtime = time.ctime(os.path.getmtime(p))
            size_mb = os.path.getsize(p) / (1024 * 1024)
            print(f" - {tag:<25} ({size_mb:.2f} MB) - Created {mtime}")


def restore_snapshot(tag):
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    zip_path = os.path.join(SNAPSHOT_DIR, f"{tag}.zip")
    if not os.path.exists(zip_path):
        print(f"Error: Snapshot '{tag}' not found in {SNAPSHOT_DIR}")
        return 1

    print(f"Rolling back to snapshot: {tag}...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(APP_ROOT)
    print(f"✓ Rollback complete! Restored files from {tag}.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Rollback and snapshot safety tool.")
    parser.add_argument("--snapshot", nargs="?", const="auto", help="Create a snapshot with optional name")
    parser.add_argument("--restore", help="Restore code to designated snapshot tag")
    parser.add_argument("--list", action="store_true", help="List all recorded snapshots")

    args = parser.parse_args()

    if args.list:
        list_snapshots()
        return 0
    elif args.restore:
        return restore_snapshot(args.restore)
    elif args.snapshot is not None:
        tag = None if args.snapshot == "auto" else args.snapshot
        create_snapshot(tag)
        return 0
    else:
        parser.print_help()
        return 1


if __name__ == "__main__":
    sys.exit(main())
