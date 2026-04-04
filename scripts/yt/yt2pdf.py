#!/usr/bin/env python3
"""
Orchestrate the markdown-to-PDF-to-B2 pipeline for YouTube summaries.

Usage:
  python scripts/yt/yt2pdf.py summary_en.md summary_zh-tw.md --title "Video Title" [--upload]

Reads one or more markdown summary files, converts each to styled HTML then PDF,
optionally uploads to Backblaze B2, and prints a JSON result array to stdout.

Output (JSON array):
  [
    {"lang": "en",    "md": "...", "html": "...", "pdf": "...", "url": "..."},
    {"lang": "zh-tw", "md": "...", "html": "...", "pdf": "...", "url": "..."}
  ]

Requires: google-chrome (for PDF), b2 CLI (for upload).
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

# Try to load .env from project root
try:
    from dotenv import load_dotenv

    _env_path = Path(__file__).resolve().parents[2] / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
except ImportError:
    pass

# Import sibling modules
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_html import build_html  # noqa: E402
from build_pdf import html_to_pdf  # noqa: E402
from upload_b2 import authorize_b2, upload_file  # noqa: E402


def _detect_lang(md_path: Path) -> str:
    """Guess language from filename: *_zh-tw.md → zh-tw, *_en.md → en."""
    stem = md_path.stem.lower()
    if "zh-tw" in stem or "zh_tw" in stem or "zh" in stem:
        return "zh-tw"
    if stem.endswith("_en") or stem.endswith("-en") or stem == "en":
        return "en"
    return "en"


def _sanitize_filename(title: str) -> str:
    """Create a safe filename from a video title."""
    slug = re.sub(r"[^\w\s-]", "", title).strip().lower()
    slug = re.sub(r"[\s_]+", "-", slug)
    return slug[:80] or "summary"


def process_one(
    md_path: Path,
    title: str,
    upload: bool,
    b2_prefix: str,
    b2_authorized: bool,
) -> dict:
    """Process a single markdown file through the full pipeline."""
    lang = _detect_lang(md_path)
    result = {"lang": lang, "md": str(md_path), "html": None, "pdf": None, "url": None}

    # Step 1: Markdown → HTML
    print(f"[{lang}] Building HTML...", file=sys.stderr)
    html_content = build_html(md_path, title=title, lang=lang)
    html_path = md_path.with_suffix(".html")
    html_path.write_text(html_content, encoding="utf-8")
    result["html"] = str(html_path)
    print(f"[{lang}] HTML: {html_path}", file=sys.stderr)

    # Step 2: HTML → PDF
    print(f"[{lang}] Building PDF...", file=sys.stderr)
    pdf_path = md_path.with_suffix(".pdf")
    pdf_result = html_to_pdf(html_path, pdf_path)
    if pdf_result:
        result["pdf"] = str(pdf_result)
        print(f"[{lang}] PDF: {pdf_result}", file=sys.stderr)
    else:
        print(f"[{lang}] PDF generation failed", file=sys.stderr)
        return result

    # Step 3: Upload to B2 (optional)
    if upload and pdf_result:
        if not b2_authorized:
            print(f"[{lang}] Skipping B2 upload (not authorized)", file=sys.stderr)
        else:
            b2_path = f"{b2_prefix}/{pdf_path.name}"
            print(f"[{lang}] Uploading to B2: {b2_path}...", file=sys.stderr)
            url = upload_file(pdf_result, b2_path)
            if url:
                result["url"] = url
                print(f"[{lang}] URL: {url}", file=sys.stderr)
            else:
                print(f"[{lang}] B2 upload failed", file=sys.stderr)

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Convert markdown summaries to PDF and optionally upload to B2"
    )
    parser.add_argument(
        "md_files", nargs="+", help="Markdown summary files to process"
    )
    parser.add_argument("--title", default="", help="Document title for HTML")
    parser.add_argument(
        "--upload", action="store_true", help="Upload PDFs to Backblaze B2"
    )
    parser.add_argument(
        "--prefix",
        default="yt2pdf",
        help="B2 path prefix (default: yt2pdf)",
    )
    args = parser.parse_args()

    # Authorize B2 once if uploading
    b2_authorized = False
    if args.upload:
        print("Authorizing B2...", file=sys.stderr)
        b2_authorized = authorize_b2()
        if not b2_authorized:
            print("Warning: B2 auth failed, PDFs will be built locally only", file=sys.stderr)

    b2_prefix = f"{args.prefix}/{date.today().isoformat()}"

    results = []
    for md_file in args.md_files:
        md_path = Path(md_file)
        if not md_path.exists():
            print(f"Error: {md_path} not found, skipping", file=sys.stderr)
            continue
        result = process_one(md_path, args.title, args.upload, b2_prefix, b2_authorized)
        results.append(result)

    # Output JSON to stdout for Claude to parse
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
