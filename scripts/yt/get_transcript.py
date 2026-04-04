#!/usr/bin/env python3
"""
Extract transcript for a YouTube video.

Priority: manual EN subs -> auto-generated EN subs -> Whisper via HF API.

Usage:
  python scripts/yt/get_transcript.py VIDEO_ID

Outputs plain text transcript to stdout.
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# Try to load .env
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def download_subtitles(video_url: str, out_dir: Path, lang: str = "en") -> Path | None:
    """Download manual or auto-generated subtitles. Returns .srt path or None."""
    out_dir.mkdir(parents=True, exist_ok=True)
    srt_path = out_dir / f"video.{lang}.srt"

    # Try manual subs first
    subprocess.run(
        [
            "yt-dlp",
            "--write-subs",
            "--sub-lang",
            lang,
            "--sub-format",
            "srt",
            "--skip-download",
            "-o",
            str(out_dir / "video"),
            video_url,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if srt_path.exists() and srt_path.stat().st_size > 0:
        return srt_path
    # Glob fallback — yt-dlp may normalize lang codes differently
    for candidate in out_dir.glob("video.*.srt"):
        if candidate.stat().st_size > 0:
            return candidate

    # Try auto-generated subs
    subprocess.run(
        [
            "yt-dlp",
            "--write-auto-subs",
            "--sub-lang",
            lang,
            "--sub-format",
            "srt",
            "--skip-download",
            "-o",
            str(out_dir / "video"),
            video_url,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if srt_path.exists() and srt_path.stat().st_size > 0:
        return srt_path
    for candidate in out_dir.glob("video.*.srt"):
        if candidate.stat().st_size > 0:
            return candidate

    return None


def srt_to_text(srt_path: Path) -> str:
    """Convert SRT to plain text (strip timestamps and sequence numbers)."""
    content = srt_path.read_text(encoding="utf-8")
    lines = []
    for line in content.splitlines():
        line = line.strip()
        if re.match(r"^\d+$", line):
            continue
        if re.match(r"^\d{2}:\d{2}:\d{2}", line):
            continue
        if not line:
            continue
        lines.append(line)
    return "\n".join(lines)


def srt_to_timestamped_text(srt_path: Path, interval: int = 30) -> str:
    """Convert SRT to text with [MM:SS] markers every ~interval seconds."""
    content = srt_path.read_text(encoding="utf-8")
    result = []
    last_emitted = -interval  # emit on first entry
    current_ts_seconds = 0

    for line in content.splitlines():
        line = line.strip()
        if not line or re.match(r"^\d+$", line):
            continue
        ts_match = re.match(r"(\d{2}):(\d{2}):(\d{2}),\d{3}\s*-->", line)
        if ts_match:
            h, m, s = int(ts_match.group(1)), int(ts_match.group(2)), int(ts_match.group(3))
            current_ts_seconds = h * 3600 + m * 60 + s
            continue
        # Text line — prepend timestamp marker if interval elapsed
        if current_ts_seconds - last_emitted >= interval:
            mm = current_ts_seconds // 60
            ss = current_ts_seconds % 60
            result.append(f"[{mm:02d}:{ss:02d}] {line}")
            last_emitted = current_ts_seconds
        else:
            result.append(line)

    return "\n".join(result)


def whisper_transcribe_hf(video_url: str, out_dir: Path) -> str | None:
    """Download audio and transcribe via HuggingFace Inference API."""
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        print("HF_TOKEN not set, cannot use Whisper fallback", file=sys.stderr)
        return None

    # Download audio
    audio_path = out_dir / "audio.m4a"
    subprocess.run(
        [
            "yt-dlp",
            "-f",
            "worstaudio[ext=m4a]/worstaudio",
            "--extract-audio",
            "--audio-format",
            "m4a",
            "-o",
            str(audio_path),
            video_url,
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if not audio_path.exists():
        # Check for alternative extensions
        candidates = list(out_dir.glob("audio*"))
        if candidates:
            candidates[0].rename(audio_path)
    if not audio_path.exists():
        print("Audio download failed", file=sys.stderr)
        return None

    # Convert to wav for HF API
    wav_path = out_dir / "audio.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-i",
            str(audio_path),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-y",
            str(wav_path),
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if not wav_path.exists():
        print("FFmpeg conversion failed", file=sys.stderr)
        return None

    try:
        from huggingface_hub import InferenceClient

        client = InferenceClient(token=hf_token)
        result = client.automatic_speech_recognition(
            str(wav_path),
            model="openai/whisper-large-v3-turbo",
        )
        return result.text
    except Exception as e:
        print(f"Whisper HF failed: {e}", file=sys.stderr)
        return None


LANG_FALLBACKS = {
    "zh-tw": ["zh-Hant", "zh-TW", "zh", "en"],
    "zh": ["zh-Hans", "zh-CN", "zh", "en"],
    "ja": ["ja", "en"],
    "ko": ["ko", "en"],
}


def get_transcript(
    video_id: str, lang: str = "en", timestamps: bool = False
) -> str | None:
    """Get transcript for a video using subtitle download with Whisper fallback."""
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    convert = srt_to_timestamped_text if timestamps else srt_to_text
    langs_to_try = LANG_FALLBACKS.get(lang, [lang, "en"]) if lang != "en" else ["en"]

    with tempfile.TemporaryDirectory(prefix="yt_transcript_") as tmpdir:
        tmp = Path(tmpdir)

        for try_lang in langs_to_try:
            print(f"Trying {try_lang} subtitles for {video_id}...", file=sys.stderr)
            srt = download_subtitles(video_url, tmp, lang=try_lang)
            if srt:
                text = convert(srt)
                if len(text) > 100:
                    print(
                        f"Got subtitle transcript in {try_lang} ({len(text)} chars)",
                        file=sys.stderr,
                    )
                    return text

        # Whisper fallback (no timestamps available)
        print(f"Falling back to Whisper for {video_id}...", file=sys.stderr)
        text = whisper_transcribe_hf(video_url, tmp)
        if text and len(text) > 100:
            print(f"Got Whisper transcript ({len(text)} chars)", file=sys.stderr)
            return "[NO_TIMESTAMPS]\n" + text if timestamps else text

    print(f"No transcript available for {video_id}", file=sys.stderr)
    return None


def main():
    parser = argparse.ArgumentParser(description="Extract YouTube video transcript")
    parser.add_argument("video_id", help="YouTube video ID")
    parser.add_argument(
        "--lang", default="en", help="Subtitle language (default: en)"
    )
    parser.add_argument(
        "--timestamps",
        action="store_true",
        help="Preserve [MM:SS] timestamp markers (~30s intervals)",
    )
    args = parser.parse_args()

    transcript = get_transcript(args.video_id, lang=args.lang, timestamps=args.timestamps)
    if transcript:
        print(transcript)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
