# Lyra Traveler Mode — Complete Setup Guide

## Overview

**Traveler Mode** is a vision-powered feature that lets users snap photos of menus, signs, products, or currency and get instant explanations in their target language. Built on **Google Gemini 2.5-flash**, it includes:

- 📸 Image capture or file upload (web + mobile)
- 🌍 Multi-language instant explanations
- ⚠️ Automatic safety/urgency flagging (warnings, expired items, etc.)
- 🔊 Text-to-speech audio playback
- 📋 Capture history with safe recall

---

## Backend Setup (Kaggle)

### 1. Add Gemini API Key to Kaggle Secrets

1. Go to **Kaggle → Account → Settings → API**
2. Click **"Create New API Token"** and download `kaggle.json`
3. Go back to **Account → Secrets**
4. Add a new secret:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** Paste your free key from [Google AI Studio](https://aistudio.google.com/app/apikey)
5. Save

> **Free Tier:** ~1,500 requests/day. No credit card required.

### 2. Replace Your Kaggle Notebook Code

Replace your entire notebook cell with the contents of `kaggle_backend_enhanced.py` provided in the repo.

Key new endpoints:

```
POST   /traveler/analyze         → Image → explanation + TTS + safety flag
GET    /traveler/history         → Retrieve last N captures (default 20)
GET    /traveler/history/{id}    → Get single entry with audio
DELETE /traveler/history         → Clear all history
GET    /health                   → Server status
```

### 3. Install Dependencies (if needed)

Most are pre-installed on Kaggle. If you see import errors:

```python
# In notebook, before your main code:
!pip install google-cloud-texttospeech --quiet
```

### 4. Run the Notebook

- Execute the cell. Server starts on `0.0.0.0:8000`
- Localtunnel creates a public URL (e.g., `https://xyz.loca.lt`)
- Update your frontend `TRAVELER_API_URL` constant if the tunnel URL changes

---

## Frontend Setup (Your Website)

### 1. Update API Endpoints

In `script.js`, update these URLs to match your Kaggle tunnel URL:

```javascript
const TRAVELER_API_URL = 'https://your-tunnel-url.loca.lt/traveler/analyze';
const TRAVELER_HISTORY_URL = 'https://your-tunnel-url.loca.lt/traveler/history';
```

### 2. HTML Changes

- ✅ Added new **Traveler** section in `index.html` with:
  - Image upload + camera capture buttons
  - Mode selector (Menu / Sign / Product / Currency / Object)
  - Language input
  - Analyze button
  - Results display with safety banner & TTS controls
  - Capture history view

- ✅ Updated navigation (desktop + mobile) to include "Traveler" tab

### 3. JavaScript Features (Already Wired)

All handlers in `script.js`:

- `handleImageSelect(file)` — Preview selected/captured image
- `analyzeTravelerImage()` — Send to backend, handle response
- `displayTravelerResults(data)` — Show explanation, safety flag, TTS
- `loadTravelerHistory()` — Fetch history from backend
- `renderTravelerHistory()` — Display capture timeline

---

## Usage

### On Desktop

1. Open the website → **Traveler** tab
2. Click **Upload Image** or take a photo
3. Select a mode (menu, sign, etc.) and target language
4. Click **Analyze Image**
5. See explanation + audio playback
6. History appears below; click to replay

### On Mobile

1. Bottom nav → **Traveler** tab
2. **Tap camera icon** (or **Upload** button for files)
3. Capture or select image
4. Choose mode & language
5. Tap **Analyze Image**
6. Listen to TTS, save to history

---

## Backend Endpoints Reference

### POST `/traveler/analyze`

**Request:**
```bash
curl -X POST https://your-url/traveler/analyze \
  -F "image=@photo.jpg" \
  -F "target_language=Turkish" \
  -F "mode=menu"
```

**Response:**
```json
{
  "status": "success",
  "mode": "menu",
  "target_language": "Turkish",
  "explanation": "Bu menu item contains...",
  "safety_flag": "warning",  // "none", "warning", "urgent"
  "audio_url": "data:audio/mp3;base64,...",
  "entry_id": "traveler_1720xxx"
}
```

### GET `/traveler/history?limit=20`

Returns last N entries with id, timestamp, mode, language, explanation, safety_flag, has_audio.

### GET `/traveler/history/{entry_id}`

Retrieve single entry including `audio_url` for playback.

### DELETE `/traveler/history`

Clear all in-memory history.

---

## Safety Flagging

The backend heuristically detects warnings/urgent items:

**Urgent keywords:** "poison", "toxic", "danger", "closed", "do not", "emergency", "illegal", etc.
**Warning keywords:** "warning", "expired", "not recommended", "allergen", "careful", etc.

UI shows:
- 🚨 **Urgent** (red banner) — Prominently flagged
- ⚠️ **Warning** (orange) — Caution recommended
- ✓ **OK** (green) — Safe/neutral

---

## TTS Audio (Optional)

If Google Cloud TTS credentials (`GOOGLE_APPLICATION_CREDENTIALS`) are available on Kaggle:

- Audio is auto-generated in the target language
- Returned as `data:audio/mp3;base64,...`
- Frontend plays via `<audio>` element
- If TTS unavailable, `audio_url` is `null` (still works without audio)

---

## Rate Limiting & Free Tier

**Gemini free tier:** ~1,500 requests/day

Monitor usage:

```bash
# Check server health (includes free tier info)
curl https://your-url/health
```

If you exceed limits:
1. **Option A:** Add rate-limit middleware in backend
2. **Option B:** Upgrade to paid (still very cheap ~$0.001/image)
3. **Option C:** Implement client-side request caching

Example rate-limit wrapper (optional):

```python
from datetime import datetime, timedelta

last_request_time = {}

async def check_rate_limit(client_id: str, max_per_hour=100):
    now = datetime.now()
    if client_id not in last_request_time:
        last_request_time[client_id] = []
    
    last_request_time[client_id] = [
        t for t in last_request_time[client_id]
        if (now - t) < timedelta(hours=1)
    ]
    
    if len(last_request_time[client_id]) >= max_per_hour:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    
    last_request_time[client_id].append(now)
```

---

## Testing Checklist

### Backend

- [ ] Kaggle notebook runs without errors
- [ ] POST `/traveler/analyze` with a test image (curl/Postman)
- [ ] Response includes explanation + safety_flag + audio_url
- [ ] GET `/traveler/history` returns captures
- [ ] GET `/health` shows `"tts_available": true` (if credentials set)

### Frontend

- [ ] Desktop: Traveler tab loads
  - [ ] Upload button opens file picker
  - [ ] Image preview shows selected photo
  - [ ] Analyze button triggers request
  - [ ] Explanation displays with correct font/alignment
  - [ ] Safety banner shows if warning/urgent
  - [ ] Audio plays if available
  - [ ] History list updates below

- [ ] Mobile: Traveler tab loads
  - [ ] Camera button navigates to Traveler + opens camera
  - [ ] Upload button works
  - [ ] Results render in mobile layout (no overlap)
  - [ ] Audio playback works on small screen

---

## Troubleshooting

### "Image analysis failed: 403"
- Check GEMINI_API_KEY in Kaggle secrets
- Verify key is valid (test via Google AI Studio web interface)

### "TTS unavailable" in health check
- Google Cloud Text-to-Speech not installed or credentials missing
- Backend will still work without TTS (audio_url = null)

### History not loading
- Check CORS headers (should be `"*"` in backend)
- Check browser console for network errors
- Verify tunnel URL is correct and online

### Audio doesn't play
- Check that `audio_url` is a valid data URL
- Verify browser supports `<audio>` element (all modern browsers do)
- Try manual playback: `<audio src={audio_url} controls />`

### Rate limit exceeded
- Implement exponential backoff on frontend
- Add client-side cache (don't re-analyze same image)
- Monitor `/health` endpoint usage

---

## Future Enhancements

1. **Web Speech API for input** — Mic button transcribes speech → send to traveler
2. **Crop/zoom on image** — Users can zoom before analysis
3. **Multi-language output** — Analyze in 3+ languages at once
4. **Persistent storage** — Save history to DB instead of in-memory
5. **Batch mode** — Send 5+ images at once for bulk analysis
6. **Confidence scoring** — Gemini returns confidence % per explanation
7. **Custom mode definitions** — User-defined analysis modes (e.g., "street vendor pricing")

---

## Support & Debugging

### Enable verbose logging:

**Backend (Kaggle):**
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

**Frontend (Browser console):**
```javascript
// In script.js, add:
const DEBUG = true;

// Then use in handlers:
if (DEBUG) console.log('[Traveler]', data);
```

### Monitor free tier usage:

```bash
# Gemini API Dashboard
https://aistudio.google.com/app/apikey  # Check quota

# Kaggle notebook output
# Look for TTS/API call counts in the cell output
```

---

## Deployment Notes

- **Kaggle notebook:** Restarts if idle >30 min; tunnel URL may change
- **Production setup:** Replace localtunnel with proper domain + backend server
- **Scalability:** Current in-memory history holds 50 entries; use DB for millions

---

**Version:** 1.0 | **Last Updated:** July 6, 2026  
**Built with:** FastAPI + Gemini 2.5-flash + Tailwind CSS
