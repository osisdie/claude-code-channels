#!/usr/bin/env python3
"""
Upload a file to Backblaze B2 and print the download URL.

Usage:
  python scripts/yt/upload_b2.py FILE [--prefix ai-digest-yt/2026-03-11]

Requires B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME in environment or .env.

Outputs the download URL to stdout.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Try to load .env
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def _b2_cmd() -> list[str]:
    """Find the b2 CLI command. Tries 'b2' binary first, falls back to python -m b2."""
    if shutil.which("b2"):
        return ["b2"]
    # b2 v1.3.8 installed in system python without a CLI entrypoint
    for py in ["/usr/bin/python3", "python3", "python"]:
        if shutil.which(py):
            r = subprocess.run(
                [py, "-m", "b2", "version"], capture_output=True, text=True
            )
            if r.returncode == 0:
                return [py, "-m", "b2"]
    return ["b2"]  # let it fail with a clear error


def authorize_b2() -> bool:
    """Authorize the b2 CLI. Returns True on success."""
    key_id = os.environ.get("B2_KEY_ID")
    app_key = os.environ.get("B2_APP_KEY")
    if not key_id or not app_key:
        print("B2_KEY_ID and B2_APP_KEY must be set", file=sys.stderr)
        return False

    result = subprocess.run(
        [*_b2_cmd(), "authorize-account", key_id, app_key],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        print(f"b2 authorize-account failed: {result.stderr[:300]}", file=sys.stderr)
        return False
    return True


def upload_file(local_path: Path, b2_path: str, duration: int = 604800) -> str | None:
    """Upload a file to B2. Returns presigned download URL or None."""
    bucket = os.environ.get("B2_BUCKET_NAME")
    if not bucket:
        print("B2_BUCKET_NAME must be set", file=sys.stderr)
        return None

    result = subprocess.run(
        [*_b2_cmd(), "upload-file", bucket, str(local_path), b2_path],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        print(f"b2 upload-file failed: {result.stderr[:300]}", file=sys.stderr)
        return None

    # Generate a presigned URL for private buckets
    return _get_presigned_url(bucket, b2_path, duration)


def _get_presigned_url(bucket: str, b2_path: str, duration: int = 604800) -> str | None:
    """Get a presigned download URL. Default duration: 7 days (604800s)."""
    result = subprocess.run(
        [
            *_b2_cmd(),
            "get-download-url-with-auth",
            "--duration",
            str(duration),
            bucket,
            b2_path,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        print(
            f"b2 get-download-url-with-auth failed: {result.stderr[:300]}",
            file=sys.stderr,
        )
        # Fallback to direct URL (will 401 on private buckets)
        return f"https://f005.backblazeb2.com/file/{bucket}/{b2_path}"

    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description="Upload file to Backblaze B2")
    parser.add_argument("file", help="Local file to upload")
    parser.add_argument(
        "--prefix",
        default="ai-digest-yt",
        help="B2 path prefix (default: ai-digest-yt)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=604800,
        help="Presigned URL expiry in seconds (default: 604800 = 7 days)",
    )
    args = parser.parse_args()

    local_path = Path(args.file)
    if not local_path.exists():
        print(f"Error: {local_path} not found", file=sys.stderr)
        sys.exit(1)

    b2_path = f"{args.prefix}/{local_path.name}"

    print("Authorizing B2...", file=sys.stderr)
    if not authorize_b2():
        sys.exit(1)

    print(f"Uploading {local_path.name} -> {b2_path}...", file=sys.stderr)
    url = upload_file(local_path, b2_path, args.duration)
    if url:
        print(url)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
