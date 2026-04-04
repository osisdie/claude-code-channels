Convert a YouTube video into a downloadable PDF summary and upload to B2 Cloud Storage.

Input: $ARGUMENTS — A YouTube URL, optionally followed by `--lang en` or `--lang zh-tw` (default: both)

Examples:

- `/yt2pdf https://youtube.com/watch?v=xxx` → generates EN + zh-TW PDFs
- `/yt2pdf https://youtube.com/watch?v=xxx --lang en` → English PDF only
- `/yt2pdf https://youtube.com/watch?v=xxx --lang zh-tw` → Traditional Chinese PDF only

## Step 1: Parse & Acknowledge

Extract the video ID and optional `--lang` flag from input. Supported URL formats:

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/live/VIDEO_ID`

Default language: both `en` and `zh-tw`. If `--lang` is specified, only generate that one.

Compute today's date as `YYYY-MM-DD` for the output directory.

If running in a channel (Telegram/Slack), reply immediately:
> Processing YouTube video... this may take a few minutes.

Save the reply message ID so you can edit it later with progress updates.

## Step 2: Download Thumbnail

Download the YouTube video thumbnail to the output directory:

```bash
mkdir -p output/youtube/YYYY-MM-DD/VIDEO_ID
curl -sL "https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg" -o output/youtube/YYYY-MM-DD/VIDEO_ID/thumb.jpg
```

If `hqdefault.jpg` fails, try `mqdefault.jpg`. If both fail, continue without thumbnail.

## Step 3: Fetch Metadata & Extract Transcript

First, fetch video metadata (title, publish date, channel name) via yt-dlp:

```bash
yt-dlp --dump-json --skip-download "https://youtube.com/watch?v=VIDEO_ID" 2>/dev/null | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(json.dumps({'title':d.get('title',''),'uploader':d.get('uploader',''),'upload_date':d.get('upload_date',''),'duration':d.get('duration',0)}))"
```

Parse the JSON to get: title, uploader, upload_date (YYYYMMDD → YYYY-MM-DD).

Then extract transcript:

```bash
python3 scripts/yt/get_transcript.py VIDEO_ID
```

Capture the stdout output as the transcript text. If it fails, reply with the error and stop.

Update progress: "Transcript extracted (N chars). Generating summary..."

## Step 4: Generate Summary

Using the transcript, generate markdown summary file(s) in `output/youtube/YYYY-MM-DD/VIDEO_ID/`.

**Important**:

- Each summary MUST include the thumbnail image reference (`thumb.jpg` — embedded as base64 in PDF automatically)
- Include metadata: title, YouTube link, published date, uploader/publisher
- Include 3-5 **tags**: lowercase English topic tags covering companies (e.g. nvidia, openai), technologies (e.g. inference, rag), categories (e.g. policy, research, product, open-source)

### If lang includes `en` → write `output/youtube/YYYY-MM-DD/VIDEO_ID/summary_en.md`

Each metadata field MUST be on its own line. Use HTML `<br>` line breaks to ensure they render separately in the PDF:

```markdown
# Video Title

![Video Title](thumb.jpg)

**Publisher**: Uploader Name<br>
**Source**: [Watch on YouTube](https://youtube.com/watch?v=VIDEO_ID)<br>
**Published**: 2026-04-04<br>
**Tags**: tag1, tag2, tag3, tag4, tag5

## Summary

3-5 paragraph English summary covering:
- Key points and main arguments
- Notable quotes or data points
- Conclusions and takeaways
```

### If lang includes `zh-tw` → write `output/youtube/YYYY-MM-DD/VIDEO_ID/summary_zh-tw.md`

```markdown
# 影片標題（中文翻譯）

![影片標題](thumb.jpg)

**頻道**: Uploader Name<br>
**來源**: [在 YouTube 上觀看](https://youtube.com/watch?v=VIDEO_ID)<br>
**發布日期**: 2026-04-04<br>
**標籤**: tag1, tag2, tag3, tag4, tag5

## 摘要

3-5 段繁體中文摘要，涵蓋：
- 重點與主要論點
- 值得注意的引用或數據
- 結論與要點
```

**Important**: Use Traditional Chinese (繁體中文) only. Never use Simplified Chinese.

Write file(s) using the Write tool.

Update progress: "Summary generated. Building PDFs..."

## Step 5: Build PDFs & Upload to B2

Run the orchestrator script with the summary file(s) you generated:

```bash
# Both languages (default)
python3 scripts/yt/yt2pdf.py output/youtube/YYYY-MM-DD/VIDEO_ID/summary_en.md output/youtube/YYYY-MM-DD/VIDEO_ID/summary_zh-tw.md --title "Video Title" --upload --prefix yt2pdf

# English only
python3 scripts/yt/yt2pdf.py output/youtube/YYYY-MM-DD/VIDEO_ID/summary_en.md --title "Video Title" --upload --prefix yt2pdf

# zh-TW only
python3 scripts/yt/yt2pdf.py output/youtube/YYYY-MM-DD/VIDEO_ID/summary_zh-tw.md --title "Video Title" --upload --prefix yt2pdf
```

Parse the JSON output from stdout. It returns an array like:

```json
[
  {"lang": "en",    "pdf": "output/youtube/.../summary_en.pdf",    "url": "https://..."},
  {"lang": "zh-tw", "pdf": "output/youtube/.../summary_zh-tw.pdf", "url": "https://..."}
]
```

## Step 6: Reply with Results

Send a final reply (new message, not edit) that includes:

1. **Video title** + YouTube link
2. **Published date** + **Publisher/Channel**
3. **Tags** (3-5 topic tags)
4. **High-level bilingual summary** — 2-3 sentences in English + 2-3 sentences in 繁體中文
5. **Download links** — B2 presigned URLs

**For Telegram** (using reply tool):

```text
📺 Video Title
🔗 https://youtube.com/watch?v=VIDEO_ID
📅 2026-04-04 · Uploader Name
🏷 tag1, tag2, tag3, tag4

EN: 2-3 sentence summary of the video's key points...

繁中: 2-3 句影片重點摘要...

📄 PDF Downloads:
EN: <presigned_url_en>
繁中: <presigned_url_zh-tw>
```

Do NOT include `files` parameter for Telegram — B2 URLs are sufficient. Telegram sends files as separate messages which looks redundant. Only attach files as fallback when B2 upload fails.

**For Slack** (using slack_send or direct reply):

```text
:tv: *Video Title*
:link: <https://youtube.com/watch?v=VIDEO_ID|Watch on YouTube>
:calendar: 2026-04-04 · Uploader Name
:label: `tag1` `tag2` `tag3` `tag4`

*EN:* 2-3 sentence summary...

*繁中:* 2-3 句摘要...

:page_facing_up: *PDF Downloads*
> :small_blue_diamond: <URL_EN|summary_en.pdf>
> :small_blue_diamond: <URL_ZH|summary_zh-tw.pdf>
```

If B2 upload failed, attach the PDFs directly and note that download links are unavailable.

## Error Handling

- **No transcript available**: Reply "Could not extract transcript for this video. It may not have subtitles or audio."
- **PDF generation fails**: Reply with the markdown summary text directly as a fallback.
- **B2 upload fails**: Attach PDFs directly in the reply without download links.
- **Invalid URL**: Reply "Please provide a valid YouTube URL. Example: `/yt2pdf https://youtube.com/watch?v=VIDEO_ID`"
