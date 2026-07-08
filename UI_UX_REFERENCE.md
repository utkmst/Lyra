# UI/UX Changes Reference

## Navigation Updates

### Desktop Top Nav
**Before:** Translate | History | Settings | Engine  
**After:** Translate | History | Settings | Engine | **Traveler** ← NEW

### Mobile Bottom Nav (4 icons)
**Before:**  
```
Translate | History | Settings
```

**After:**  
```
Translate | History | Traveler ← NEW | Settings
```

---

## Traveler Section Layout

### Desktop View
```
┌─────────────────────────────────────────────────┐
│ Traveler Mode                                    │
│ Snap a photo of a menu, sign...                  │
│                                                   │
│ ┌───────────────────────────────────────────┐   │
│ │ 📷 Capture or Upload                      │   │
│ │                                           │   │
│ │ [Upload Image]  [Take Photo (hidden)]    │   │
│ │ ┌─────────────────────────────────────┐  │   │
│ │ │ [Image Preview Area]                │  │   │
│ │ └─────────────────────────────────────┘  │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
│ ┌───────────────────────────────────────────┐   │
│ │ Analysis Options                          │   │
│ │ Mode: [General Object▼]  Language: [___] │   │
│ └───────────────────────────────────────────┘   │
│                                                   │
│ [        Analyze Image        ]                  │
│                                                   │
│ ┌─ Results (Hidden Until Analyzed) ─────────┐   │
│ │ [🚨 Urgent Warning Banner if needed]       │   │
│ │ Explanation                                 │   │
│ │ [Turkish text here, same font as left...]  │   │
│ │ [Play Audio] [Save to History]             │   │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ Capture History                                  │
│ • [Card: Turkish, menu, 12:30pm, ✓ OK]        │
│ • [Card: English, sign, 11:45am, ⚠️ Warning]  │
│ • [Card: Spanish, currency, 10:20am, ✓ OK]   │
└─────────────────────────────────────────────────┘
```

### Mobile View
```
┌──────────────────────────────┐
│ Traveler Mode                │
│ Snap a photo...              │
├──────────────────────────────┤
│ [Upload] [Take Photo]        │
│ ┌──────────────────────────┐ │
│ │ [Image preview if any]   │ │
│ └──────────────────────────┘ │
│ Mode: [General ▼]            │
│ Language: [Turkish___]       │
│ [    Analyze Image    ]      │
├──────────────────────────────┤
│ Results                      │
│ [Warning banner if urgent]   │
│ Açıklama: [Turkish text...  │
│ [▶ Play Audio]               │
│ [✕ Save to History]          │
├──────────────────────────────┤
│ Capture History              │
│ • [Turkish, menu, OK]        │
│ • [English, sign, WARN]      │
│ • [Spanish, product, OK]     │
├─────────────────────────────┤
│ Bottom Nav                   │
│ [T] [H] [📷] [⚙]           │
└──────────────────────────────┘
```

---

## Component Details

### Image Capture Flow

**Desktop:**
```
[Upload Image Button] → File Dialog → Preview → Analyze
                    ↓
              [Camera Button] → (Hidden on Desktop)
```

**Mobile:**
```
[Camera Button] → Camera/Gallery → Preview → Analyze
      ↓
[Upload Button] → File Picker → Preview → Analyze
```

### Safety Flag Banner

Shows conditionally based on `safety_flag` response:

| Flag | Banner | Color | Icon | Text |
|------|--------|-------|------|------|
| "urgent" | Visible | Red (#ffb4ab) | 🚨 | "Urgent Warning" |
| "warning" | Visible | Orange | ⚠️ | "Warning" |
| "none" | Hidden | — | — | — |

### Audio Playback Control

```
[▶ Play Audio] → Audio starts
  ↓
[⏸ Stop Audio] → Audio stops, resets to start

(Only visible if backend returned audio_url)
```

### History Card (Per Capture)

```
┌─────────────────────────────────┐
│ Turkish • menu    [✓ OK / ⚠ / 🚨] │
│ 12:30pm • Yesterday              │
│                                  │
│ Bu yemek listesi...              │
│ [truncated to 3 lines]           │
│ [🔊 Audio available (if TTS)]    │
└─────────────────────────────────┘
```

---

## Style Consistency

### Fonts Used
- Labels: `font-label-md` (14px, 600 weight, 0.05em spacing)
- Explanation: `font-headline-lg` (32px, 700 weight) — **Same as left "Original" panel**
- Body text: `font-body-md` (16px, 400 weight)

### Colors (Tailwind + Custom)
- **Primary action:** `bg-primary-container` (#2e5bff)
- **Hover state:** `hover:bg-[#124af0]`
- **Disabled state:** `disabled:opacity-60`
- **Text:** `text-on-surface` (white) / `text-outline` (gray)
- **Cards:** `bento-card` class with dark background

### Spacing
- Container padding: `px-container-padding` (20px)
- Gap between sections: `gap-bento-gap` (16px)
- Stack spacing: `space-y-4` (typically)

---

## Responsive Breakpoints

### Mobile (< 768px)
- Single column layout
- Full-width image preview
- Mode/Language on separate rows
- History cards stack vertically
- Bottom nav visible (4 icons)

### Desktop (≥ 768px)
- Max-width container (2xl = 42rem)
- Mode + Language on same row
- Larger typography
- Top nav always visible
- History cards in grid (if multiple columns added later)

---

## Mobile Navigation Integration

### Camera Button Behavior
```
User taps camera icon (bottom nav)
  ↓
Is active section "translate"?
  ├─ YES → Navigate to "traveler" section
  │        Wait 100ms
  │        Trigger camera input click
  │
  └─ NO → Just trigger camera input click
           (if already in traveler, capture photo)
```

### Mic Button (Placeholder)
Currently logs to console; future integration points:
- Web Speech API → transcribe → populate source textarea
- Send to traveler for image→text synthesis

---

## State Management

### Frontend State (script.js)
```javascript
travelerCurrentImage    // Base64 or Blob of selected image
travelerHistory[]       // Array of recent captures from backend
appState.activeSection  // "translate", "traveler", "history", etc.
```

### Backend State (Kaggle)
```python
analysis_history[]      # In-memory list (max 50 entries)
# Structure: {id, timestamp, image_mode, target_language, 
#             explanation, safety_flag, audio_url}
```

---

## Interactions & Animations

### Button States
- **Normal:** Opacity 1, shadow
- **Hover:** Scale 1.05 (on primary buttons), opacity 0.8 (secondary)
- **Active:** Scale 0.95 (pressed effect)
- **Disabled:** Opacity 0.6, pointer-events-none

### Section Transitions
- Sections hide/show via `.hidden` class
- Nav items highlight with `text-primary` + underline
- Results panel fades in (via CSS display/hidden)

### Loading State
- Analyze button shows "Analyzing..." text
- Button disabled during fetch
- Progress visible in browser dev tools (Network tab)

---

## Accessibility Features

- Semantic HTML (`<section>`, `<article>`, `aria-labelledby`)
- Button labels + `aria-label` on icon buttons
- Color contrast meets WCAG AA
- Keyboard navigation (Tab through buttons/inputs)
- Alt text on images (placeholder.jpg)
- Form labels linked to inputs via `<label>`

---

## Common Customizations

### Change Safety Flag Colors
```css
/* In index.html <style> section */
/* Add custom color for urgent vs warning */
[data-safety="urgent"] { border-left-color: #ffb4ab; }
[data-safety="warning"] { border-left-color: #ff9800; }
```

### Adjust History Display (More/Fewer Cards)
```javascript
// In renderTravelerHistory()
// Change limit in GET request:
const response = await fetch(`${TRAVELER_HISTORY_URL}?limit=50`);  // default 20
```

### Change Image Preview Size
```html
<!-- In index.html, find #image-preview element -->
<img id="image-preview" class="w-full rounded-xl max-h-64 object-cover" />
<!-- Adjust max-h-64 to max-h-96, max-h-screen, etc. -->
```

---

## Testing Checklist (UI/UX)

- [ ] Traveler tab loads without errors
- [ ] Image upload button triggers file dialog
- [ ] Camera button (desktop) hidden; mobile visible
- [ ] Image preview shows selected photo
- [ ] Clear button removes preview
- [ ] Mode selector works (5 options)
- [ ] Language input accepts text
- [ ] Analyze button disabled until image selected
- [ ] Analyze button shows "Analyzing..." during fetch
- [ ] Results display explanation in correct font
- [ ] Safety banner shows (red) for urgent, (orange) for warning
- [ ] Audio button appears only if `audio_url` present
- [ ] Play audio triggers playback
- [ ] History renders with correct metadata
- [ ] Mobile layout stacks vertically
- [ ] Desktop layout centered with max-width
- [ ] No overlaps with bottom nav on mobile
- [ ] Responsive at 375px, 768px, 1024px widths

---

**UI/UX Version:** 2.0 | **Last Updated:** July 6, 2026
