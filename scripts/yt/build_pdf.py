#!/usr/bin/env python3
"""
Convert an HTML file to PDF using headless Chrome.

Usage:
  python scripts/yt/build_pdf.py INPUT.html [-o OUTPUT.pdf]

Outputs PDF path to stdout on success.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

_CHROME_CANDIDATES = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]


def _find_chrome() -> str | None:
    for candidate in _CHROME_CANDIDATES:
        if shutil.which(candidate):
            return candidate
    return None


def html_to_pdf(html_path: Path, pdf_path: Path) -> Path | None:
    """Convert HTML to PDF via headless Chrome --print-to-pdf."""
    chrome = _find_chrome()
    if not chrome:
        print("Chrome/Chromium not found", file=sys.stderr)
        return None

    file_uri = html_path.resolve().as_uri()

    cmd = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-software-rasterizer",
        f"--print-to-pdf={pdf_path.resolve()}",
        "--no-pdf-header-footer",
        "--print-to-pdf-no-header",
        file_uri,
    ]

    print(f"Generating PDF: {pdf_path.name}...", file=sys.stderr)
    subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if not pdf_path.exists():
        print("PDF generation failed", file=sys.stderr)
        return None

    print(f"PDF: {pdf_path} ({pdf_path.stat().st_size / 1024:.0f} KB)", file=sys.stderr)
    return pdf_path


def main():
    parser = argparse.ArgumentParser(description="Convert HTML to PDF")
    parser.add_argument("html_file", help="Input HTML file")
    parser.add_argument("-o", "--output", default=None, help="Output PDF path")
    args = parser.parse_args()

    html_path = Path(args.html_file)
    if not html_path.exists():
        print(f"Error: {html_path} not found", file=sys.stderr)
        sys.exit(1)

    pdf_path = Path(args.output) if args.output else html_path.with_suffix(".pdf")

    result = html_to_pdf(html_path, pdf_path)
    if result:
        print(str(result))
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
