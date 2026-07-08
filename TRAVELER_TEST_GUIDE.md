# Quick Test Guide

## 1. Backend Test (curl)

Assuming your Kaggle tunnel is: `https://your-tunnel.loca.lt`

### Test /traveler/analyze

```bash
# Download a test image or use your own
# Then POST it:

curl -X POST https://your-tunnel.loca.lt/traveler/analyze \
  -F "image=@test_menu.jpg" \
  -F "target_language=Turkish" \
  -F "mode=menu" \
  -H "Accept: application/json"

# Expected response:
# {
#   "status": "success",
#   "explanation": "Bu yemek listesi... [Turkish text]",
#   "safety_flag": "none",
#   "audio_url": "data:audio/mp3;base64,..."
# }
```

### Test /traveler/history

```bash
curl https://your-tunnel.loca.lt/traveler/history?limit=5

# Expected: list of recent captures
```

### Test /health

```bash
curl https://your-tunnel.loca.lt/health

# Expected:
# {
#   "status": "ok",
#   "history_size": 3,
#   "tts_available": true
# }
```

---

## 2. Frontend Test (Browser)

### Update config in script.js

```javascript
// Top of script.js, replace your URLs:
const TRAVELER_API_URL = 'https://your-tunnel.loca.lt/traveler/analyze';
const TRAVELER_HISTORY_URL = 'https://your-tunnel.loca.lt/traveler/history';
```

### Desktop Test

1. Open browser dev tools (F12)
2. Go to your website → **Traveler** tab
3. Click **Upload Image**
4. Select a photo (menu, sign, product, etc.)
5. Pick mode & language
6. Click **Analyze Image**
7. Watch Network tab in dev tools for POST request
8. See results render in page
9. If TTS works, click **Play Audio**
10. Scroll down to see capture in **History**

### Mobile Test

1. Open on phone or responsive design mode (F12 → responsive)
2. Bottom nav → **Traveler** icon
3. Tap camera button → take photo
4. Mode: select "menu", Language: type "Turkish"
5. Tap **Analyze Image**
6. See explanation + audio
7. Scroll to history

---

## 3. Safety Flag Test

Try uploading images with these subjects:

- **Menu item:** Common for allergen warnings → safety_flag: "warning"
- **Expired product:** Date visible → safety_flag: "warning"
- **Hazmat/poison label:** safety_flag: "urgent"
- **Normal object:** safety_flag: "none"

Check the UI shows correct banner color.

---

## 4. TTS Audio Test

1. Analyze an image
2. Look for **"Play Audio"** button
3. If it appears, TTS is working
4. Click to play; text-to-speech in target language should play
5. If button doesn't appear, check:
   - Browser console for errors
   - Backend logs for TTS errors
   - Health endpoint: `tts_available` field

---

## 5. History Test

1. Analyze 3+ different images
2. Scroll to **Capture History** section
3. Recent captures should appear (newest first)
4. Each card shows:
   - Language + mode
   - Timestamp
   - Safety flag badge
   - Snippet of explanation
   - "Audio available" indicator if TTS ran
5. Try GET `/traveler/history` in curl to verify backend stores them

---

## 6. Error Scenarios

### Scenario A: Bad image
```bash
curl -X POST https://your-tunnel.loca.lt/traveler/analyze \
  -F "image=@not_an_image.txt" \
  -F "target_language=Turkish"
```
Expected: 400 or 500 error with message

### Scenario B: Invalid language code
```bash
curl -X POST https://your-tunnel.loca.lt/traveler/analyze \
  -F "image=@test.jpg" \
  -F "target_language=Klingon"
```
Expected: Still works (Gemini will try to interpret "Klingon" or default to English)

### Scenario C: Exceed free tier quota
- After ~1,500 requests today, all requests fail with quota error
- Response includes helpful message to upgrade or wait
- Check `/health` endpoint — may show rate limit info

---

## 7. Cross-Browser Testing

| Browser | Desktop | Mobile | Notes |
|---------|---------|--------|-------|
| Chrome  | ✓       | ✓      | Best support for audio playback |
| Safari  | ✓       | ✓      | May need workaround for autoplay audio |
| Firefox | ✓       | ✓      | Full support |
| Edge    | ✓       | ~      | Works; audio playback good |

---

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| "NetworkError" in console | Tunnel URL wrong or server down; check `/health` |
| Image preview doesn't show | Check file extension is `.jpg/.png`; try drag-drop instead |
| Analyze button disabled | No image selected; pick one first |
| No safety banner but expected warning | Backend heuristic may not match; check explanation text |
| Audio doesn't play | Try Firefox/Chrome; check if MP3 data URL is valid |
| History empty | Server restarted (clears in-memory store); analyze new images |

---

## Success Criteria

✅ All tests pass if:

- [ ] POST `/traveler/analyze` returns JSON with explanation + audio
- [ ] UI renders explanation, safety banner (if needed), and audio button
- [ ] History loads and displays captures
- [ ] Mobile layout works without nav overlap
- [ ] TTS plays (if available)
- [ ] No console errors

Once all ✅, you're ready to deploy or share with users!

---

**Test Date:** ________ | **Tester:** ________ | **Status:** ________
