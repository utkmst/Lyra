/**
 * Lyra — Cultural Synthesis
 * FastAPI translate endpoint integration
 */

const DEFAULT_API_BASE = 'https://solid-baths-trade.loca.lt'; // Kaggle ilk açıldığında görünen adres, yedek olarak kalsın

function getApiBase() {
  const saved = localStorage.getItem('lyra_api_base');
  return (saved && saved.trim()) ? saved.trim().replace(/\/$/, '') : DEFAULT_API_BASE;
}

function setApiBase(url) {
  const cleaned = url.trim().replace(/\/$/, '');
  localStorage.setItem('lyra_api_base', cleaned);
}

// Bu 4 sabiti artık fonksiyon çağrısına çeviriyoruz, her istekte güncel URL okunacak
function getApiUrl() { return `${getApiBase()}/translate`; }
function getTravelerTranslationUrl() { return `${getApiBase()}/traveler/translation`; }
function getTravelerAnalyzeUrl() { return `${getApiBase()}/traveler/analyze`; }
function getTravelerHistoryUrl() { return `${getApiBase()}/traveler/history`; }

const LANGUAGE_SUGGESTIONS = [
  'Japanese (Business)',
  'French (Casual)',
  'Arabic (Formal)',
  'English (Professional)',
  'Turkish',
  'German (Formal)',
  'Spanish (Casual)',
  'Korean (Business)',
  'Chinese (Simplified)',
  'Italian',
  'Portuguese (Brazil)',
  'Russian (Formal)',
  'Hindi',
  'Dutch',
  'Swedish',
];

const PERSONA_SUGGESTIONS = [
  'Diplomatic',
  'Direct',
  'Poetic',
  'Professional',
  'Casual',
  'Academic',
  'Empathetic',
  'Humorous',
  'Persuasive',
  'Concise',
  'Storytelling',
  'Technical',
];

const DEFAULT_LANGUAGE = 'Japanese (Business)';
const DEFAULT_PERSONA = 'Diplomatic';

/** @type {HTMLElement | null} */
let activeAutocomplete = null;

/** @type {{ id: string; source: string; targetLanguage: string; persona: string; output: string; coreMeaning?: string; valence?: string; speechAct?: string; timestamp: number }[]} */
const sessionHistory = [];

/** @type {any | null} */
let lastEnginePayload = null;

/** Traveler mode state */
let travelerCurrentImage = null;  // Compressed Blob or fallback data URL
let travelerCurrentImagePreviewUrl = '';
let travelerCurrentTranslation = '';
let travelerHistory = [];  // Cache from /traveler/history

const TRAVELER_IMAGE_MAX_DIMENSION = 1024;
const TRAVELER_IMAGE_QUALITY = 0.7;

function clearTravelerPreviewUrl() {
  if (travelerCurrentImagePreviewUrl) {
    URL.revokeObjectURL(travelerCurrentImagePreviewUrl);
    travelerCurrentImagePreviewUrl = '';
  }
}

function resetTravelerFlow() {
  travelerCurrentTranslation = '';

  const applyBtn = document.getElementById('apply-translation-btn');
  const translationCard = document.getElementById('traveler-translation-card');
  const translationText = document.getElementById('traveler-translation');
  const discoverBtn = document.getElementById('discover-context-btn');
  const resultsDiv = document.getElementById('traveler-results');
  const safetyBanner = document.getElementById('safety-flag-banner');
  const ttsControls = document.getElementById('tts-controls');

  if (applyBtn) {
    applyBtn.classList.add('hidden');
    applyBtn.disabled = true;
    setTravelerButtonLabel(applyBtn, 'Apply Quick Translation');
  }
  if (translationCard) translationCard.classList.add('hidden');
  if (translationText) translationText.textContent = '';
  if (discoverBtn) {
    discoverBtn.classList.add('hidden');
    discoverBtn.disabled = true;
    setTravelerButtonLabel(discoverBtn, 'Discover Context');
  }
  if (resultsDiv) resultsDiv.classList.add('hidden');
  if (safetyBanner) safetyBanner.classList.add('hidden');
  if (ttsControls) ttsControls.classList.add('hidden');
}

function setTravelerButtonLabel(button, label) {
  if (!button) return;
  const textSpan = button.querySelector('span:last-child');
  if (textSpan) {
    textSpan.textContent = label;
  } else {
    button.textContent = label;
  }
}

function getTravelerTranslationDisplayText() {
  if (!travelerCurrentTranslation) return '';
  if (travelerCurrentTranslation === 'NO_TEXT_FOUND') {
    return 'No readable text found. Use Discover Context to identify the scene.';
  }
  return travelerCurrentTranslation;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for compression'));
    image.src = url;
  });
}

async function compressTravelerImage(file) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(
      1,
      TRAVELER_IMAGE_MAX_DIMENSION / Math.max(image.width || 1, image.height || 1)
    );
    const width = Math.max(1, Math.round((image.width || 1) * scale));
    const height = Math.max(1, Math.round((image.height || 1) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context unavailable');
    }

    context.drawImage(image, 0, 0, width, height);

    const compressedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas compression failed'));
          }
        },
        'image/jpeg',
        TRAVELER_IMAGE_QUALITY
      );
    });

    return compressedBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** App state for section + settings */
const appState = {
  activeSection: 'translate',
  uiLanguage: 'en',
  theme: 'cosmic',
  effectsEnabled: true,
  dynamicBackground: true,
};

const UI_COPY = {
  en: {
    brand: { tagline: 'Cultural Synthesis' },
    nav: { translate: 'Translate', history: 'History', settings: 'Settings', engine: 'Engine' },
    label: {
      targetContext: 'Target Context',
      nuanceProfile: 'Nuance Profile',
      originalConcept: 'Original Concept',
      synthesizedOutput: 'Synthesized Output',
      autoDetect: 'Auto-Detect',
    },
    placeholder: {
      language: 'Type a language...',
      persona: 'Type a persona...',
      source: 'Enter text or drop a document here to begin cultural synthesis...',
    },
    action: { synthesize: 'Synthesize', loading: 'Loading...', copy: 'Copy to clipboard' },
    status: {
      awaiting: 'Awaiting input for synthesis...',
      emptySource: 'Enter source text to begin synthesis.',
      failed: 'Translation failed. Check the console for details.',
    },
    history: {
      subtitle: 'Session-only timeline of your recent syntheses.',
      clear: 'Clear Session',
      empty: 'No history yet. Run a synthesis to start building this session\'s timeline.',
      output: 'Output',
    },
    settings: {
      subtitle: 'Tune Lyra\'s mood, motion, and interface language.',
      themeTitle: 'Theme',
      themeDesc: 'Choose the color universe for gradients and accents.',
      effectsTitle: 'Effects',
      effectsDesc: 'Control motion and glow for focus-friendly sessions.',
      dynamicLights: 'Dynamic Lights',
      dynamicLightsDesc: 'Toggle the rotating aurora rings.',
      dynamicBackground: 'Dynamic Background',
      dynamicBackgroundDesc: 'When off, freezes the current video frame.',
      languageTitle: 'Interface Language',
      languageDesc: 'Affects interface labels, not synthesized text.',
      on: 'ON',
      off: 'OFF',
    },
    theme: {
      cosmic: 'Cosmic',
      cosmicDesc: 'Default Lyra palette',
      aurora: 'Aurora',
      auroraDesc: 'Cool green & cyan',
      rose: 'Rose Nebula',
      roseDesc: 'Warm, storytelling',
    },
    engine: {
      subtitle: 'Peek into Lyra\'s Stage 1 brain for your latest synthesis.',
      empty: 'No engine data yet. Run a synthesis to inspect its semantic anatomy.',
      coreMeaning: 'Core Meaning',
      coreMeaningDesc: 'Neutral semantic backbone',
      valence: 'Valence',
      speechAct: 'Speech Act',
      noCore: 'No core meaning available for this run.',
      noSpeechAct: 'Unspecified speech act',
      noEntities: 'No salient named entities were highlighted for this utterance.',
    },
  },
  fr: {
    brand: { tagline: 'Synthèse Culturelle' },
    nav: { translate: 'Traduire', history: 'Historique', settings: 'Paramètres', engine: 'Moteur' },
    label: {
      targetContext: 'Contexte Cible',
      nuanceProfile: 'Profil de Nuance',
      originalConcept: 'Concept Original',
      synthesizedOutput: 'Sortie Synthétisée',
      autoDetect: 'Détection Automatique',
    },
    placeholder: {
      language: 'Entrez une langue...',
      persona: 'Entrez un persona...',
      source: 'Entrez du texte ou déposez un document ici pour commencer la synthèse culturelle...',
    },
    action: { synthesize: 'Synthétiser', loading: 'Chargement...', copy: 'Copier dans le presse-papiers' },
    status: {
      awaiting: 'En attente d\'entrée pour la synthèse...',
      emptySource: 'Entrez le texte source pour commencer la synthèse.',
      failed: 'La traduction a échoué. Vérifiez la console pour plus de détails.',
    },
    history: {
      subtitle: 'Chronologie de session de vos synthèses récentes.',
      clear: 'Effacer la Session',
      empty: 'Aucun historique pour le moment. Exécutez une synthèse pour commencer à construire la chronologie de cette session.',
      output: 'Sortie',
    },
    settings: {
      subtitle: 'Ajustez l\'humeur, le mouvement et la langue de l\'interface de Lyra.',
      themeTitle: 'Thème',
      themeDesc: 'Choisissez l\'univers de couleurs pour les dégradés et les accents.',
      effectsTitle: 'Effets',
      effectsDesc: 'Contrôlez le mouvement et la lueur pour des sessions favorables à la concentration.',
      dynamicLights: 'Lumières Dynamiques',
      dynamicLightsDesc: 'Activez/désactivez les anneaux d\'aurore rotatifs.',
      dynamicBackground: 'Arrière-plan Dynamique',
      dynamicBackgroundDesc: 'Lorsqu\'il est désactivé, fige l\'image vidéo actuelle.',
      languageTitle: 'Langue de l\'Interface',
      languageDesc: 'Affecte les étiquettes de l\'interface, pas le texte synthétisé.',
      on: 'ACTIVÉ',
      off: 'DÉSACTIVÉ',
    },
    theme: {
      cosmic: 'Cosmique',
      cosmicDesc: 'Palette par défaut de Lyra',
      aurora: 'Aurore',
      auroraDesc: 'Vert et cyan froids',
      rose: 'Nébuleuse Rose',
      roseDesc: 'Chaud, narratif',
    },
    engine: {
      subtitle: 'Jetez un œil au cerveau de Lyra de l\'étape 1 pour votre dernière synthèse.',
      empty: 'Aucune donnée moteur pour le moment. Exécutez une synthèse pour inspecter son anatomie sémantique.',
      coreMeaning: 'Signification Centrale',
      coreMeaningDesc: 'Colonne vertébrale sémantique neutre',
      valence: 'Valence',
      speechAct: 'Acte de Parole',
      noCore: 'Aucune signification centrale disponible pour cette exécution.',
      noSpeechAct: 'Acte de parole non spécifié',
      noEntities: 'Aucune entité nommée saillante n\'a été mise en évidence pour cette expression.',
    },
  },
  tr: {
    brand: { tagline: 'Kültürel Sentez' },
    nav: { translate: 'Çeviri', history: 'Geçmiş', settings: 'Ayarlar', engine: 'Motor' },
    label: {
      targetContext: 'Hedef Bağlam',
      nuanceProfile: 'Nüans Profili',
      originalConcept: 'Orijinal Konsept',
      synthesizedOutput: 'Sentetik Çıktı',
      autoDetect: 'Otomatik Algıla',
    },
    placeholder: {
      language: 'Bir dil yazın...',
      persona: 'Bir persona yazın...',
      source: 'Kültürel sentez için metin girin veya belge bırakın...',
    },
    action: { synthesize: 'Sentezle', loading: 'Yükleniyor...', copy: 'Panoya kopyala' },
    status: {
      awaiting: 'Sentez için giriş bekleniyor...',
      emptySource: 'Başlamak için kaynak metin girin.',
      failed: 'Çeviri başarısız. Konsolu kontrol edin.',
    },
    history: {
      subtitle: 'Bu oturumdaki son sentezlerinizin zaman çizelgesi.',
      clear: 'Oturumu Temizle',
      empty: 'Henüz geçmiş yok. Bu oturumun zaman çizelgesini oluşturmak için bir sentez çalıştırın.',
      output: 'Çıktı',
    },
    settings: {
      subtitle: 'Lyra\'nın ruh halini, hareketini ve arayüz dilini ayarlayın.',
      themeTitle: 'Tema',
      themeDesc: 'Gradyanlar ve vurgular için renk evrenini seçin.',
      effectsTitle: 'Efektler',
      effectsDesc: 'Odaklanma için hareket ve parıltıyı kontrol edin.',
      dynamicLights: 'Dinamik Işıklar',
      dynamicLightsDesc: 'Dönen aurora halkalarını aç/kapat.',
      dynamicBackground: 'Dinamik Arka Plan',
      dynamicBackgroundDesc: 'Kapalıyken mevcut video karesi dondurulur.',
      languageTitle: 'Arayüz Dili',
      languageDesc: 'Arayüz etiketlerini etkiler, sentez metnini değil.',
      on: 'AÇ',
      off: 'KAP',
    },
    theme: {
      cosmic: 'Kozmik',
      cosmicDesc: 'Varsayılan Lyra paleti',
      aurora: 'Aurora',
      auroraDesc: 'Serin yeşil ve camgöbeği',
      rose: 'Gül Nebulası',
      roseDesc: 'Sıcak, hikaye anlatımı',
    },
    engine: {
      subtitle: 'Son senteziniz için Lyra\'nın Aşama 1 beynine göz atın.',
      empty: 'Henüz motor verisi yok. Anlamsal anatomisini incelemek için bir sentez çalıştırın.',
      coreMeaning: 'Çekirdek Anlam',
      coreMeaningDesc: 'Nötr anlamsal omurga',
      valence: 'Duygu Tonu',
      speechAct: 'Sözcelem',
      noCore: 'Bu çalıştırma için çekirdek anlam mevcut değil.',
      noSpeechAct: 'Belirtilmemiş sözcelem',
      noEntities: 'Bu ifade için belirgin varlık vurgulanmadı.',
    },
  },
};

function t(key) {
  const parts = key.split('.');
  let value = UI_COPY[appState.uiLanguage] || UI_COPY.en;
  for (const part of parts) {
    value = value?.[part];
  }
  if (value === undefined) {
    let fallback = UI_COPY.en;
    for (const part of parts) {
      fallback = fallback?.[part];
    }
    return fallback ?? key;
  }
  return value;
}

/** Sync paired desktop/mobile form fields */
function syncField(primaryId, mirrorId) {
  const primary = document.getElementById(primaryId);
  const mirror = document.getElementById(mirrorId);
  if (!primary || !mirror) return;

  const sync = (source, target) => {
    if (target.value !== source.value) {
      target.value = source.value;
    }
  };

  primary.addEventListener('input', () => sync(primary, mirror));
  mirror.addEventListener('input', () => sync(mirror, primary));
  primary.addEventListener('change', () => sync(primary, mirror));
  mirror.addEventListener('change', () => sync(mirror, primary));
}

function getFieldValue(primaryId, mirrorId) {
  const primary = document.getElementById(primaryId);
  const mirror = document.getElementById(mirrorId);
  const desktop = window.matchMedia('(min-width: 768px)').matches;
  const active = desktop ? primary : mirror || primary;
  return active?.value.trim() ?? primary?.value.trim() ?? '';
}

function getOutputElements() {
  return [
    document.getElementById('output-content'),
    document.getElementById('output-content-mobile'),
  ].filter(Boolean);
}

function initAutocomplete(inputId, listId, suggestions) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  let highlightedIndex = -1;

  const renderSuggestions = (query) => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? suggestions.filter((item) => item.toLowerCase().includes(normalized))
      : suggestions;

    list.innerHTML = '';

    if (filtered.length === 0) {
      list.classList.add('hidden');
      highlightedIndex = -1;
      return;
    }

    filtered.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'autocomplete-item';
      li.setAttribute('role', 'option');
      li.dataset.value = item;
      li.textContent = item;

      if (index === highlightedIndex) {
        li.classList.add('is-highlighted');
      }

      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        input.value = item;
        closeAutocomplete(list);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      list.appendChild(li);
    });

    list.classList.remove('hidden');
    activeAutocomplete = list;
  };

  const closeAutocomplete = (targetList) => {
    targetList.classList.add('hidden');
    highlightedIndex = -1;
    if (activeAutocomplete === targetList) {
      activeAutocomplete = null;
    }
  };

  const highlightItem = (items) => {
    items.forEach((item, index) => {
      item.classList.toggle('is-highlighted', index === highlightedIndex);
    });
  };

  input.addEventListener('input', () => {
    renderSuggestions(input.value);
  });

  input.addEventListener('focus', () => {
    renderSuggestions(input.value);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => closeAutocomplete(list), 150);
  });

  input.addEventListener('keydown', (event) => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (list.classList.contains('hidden') || items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % items.length;
      highlightItem(items);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightedIndex = highlightedIndex <= 0 ? items.length - 1 : highlightedIndex - 1;
      highlightItem(items);
    } else if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      input.value = items[highlightedIndex].dataset.value ?? '';
      closeAutocomplete(list);
    } else if (event.key === 'Escape') {
      closeAutocomplete(list);
    }
  });
}

function setLoading(isLoading) {
  const buttons = [
    document.getElementById('synthesize-btn'),
    document.getElementById('synthesize-btn-mobile'),
  ].filter(Boolean);
  const label = document.getElementById('synthesize-label');
  const progressLines = [
    document.getElementById('progress-line'),
    document.getElementById('progress-line-mobile'),
  ].filter(Boolean);

  buttons.forEach((button) => {
    button.disabled = isLoading;
    button.classList.toggle('opacity-60', isLoading);
    button.classList.toggle('pointer-events-none', isLoading);
    button.classList.toggle('is-loading', isLoading);
  });

  if (label) {
    label.textContent = isLoading ? t('action.loading') : t('action.synthesize');
  }

  progressLines.forEach((line) => {
    line.style.width = isLoading ? '100%' : '0';
  });
}

function renderOutput(text, { isPlaceholder = false } = {}) {
  const outputs = getOutputElements();
  if (outputs.length === 0) return;

  outputs.forEach((output) => {
    const isMobile = output.id === 'output-content-mobile';

    if (isPlaceholder) {
      output.innerHTML = `
        <div class="text-center ${isMobile ? 'py-6' : 'py-8'}">
          <span class="material-symbols-outlined ${isMobile ? 'text-[40px] mb-3' : 'text-[48px] mb-4'} text-white/15 block">translate</span>
          <p class="font-body-md text-outline ${isMobile ? 'text-sm' : ''}">${text}</p>
        </div>`;
      output.className = isMobile
        ? 'flex-1 flex flex-col justify-center z-10 overflow-y-auto opacity-60'
        : 'flex-grow flex flex-col justify-center min-h-0 relative z-10 overflow-y-auto opacity-60';
      return;
    }

    output.className = isMobile
      ? 'flex-1 flex flex-col justify-center z-10 overflow-y-auto font-headline-md text-headline-md text-on-surface tracking-tight leading-snug whitespace-pre-wrap text-left'
      : 'flex-grow flex flex-col justify-center min-h-0 relative z-10 overflow-y-auto font-headline-lg text-headline-lg text-on-surface tracking-tight leading-tight whitespace-pre-wrap text-left';
    output.textContent = text;
  });
}

async function synthesize() {
  const text = getFieldValue('source-text', 'source-text-mobile');
  const language = getFieldValue('target-language', 'target-language-mobile') || DEFAULT_LANGUAGE;
  const style = getFieldValue('persona', 'persona-mobile') || DEFAULT_PERSONA;

  if (!text) {
    renderOutput(t('status.emptySource'), { isPlaceholder: true });
    return;
  }

  setLoading(true);

  try {
    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
      },
      body: JSON.stringify({
        text,
        target_language: language,
        persona: style,
      }),
    });

    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${rawBody || response.statusText}`);
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(`Invalid JSON response: ${rawBody.slice(0, 120)}`);
    }

    if (!data.final_translation) {
      throw new Error(`Response missing final_translation: ${rawBody.slice(0, 200)}`);
    }

    renderOutput(data.final_translation);

    // Persist engine + history for this session
    lastEnginePayload = data;
    try {
      const item = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        source: text,
        targetLanguage: language,
        persona: style,
        output: data.final_translation,
        coreMeaning: data.extracted_data?.core_meaning ?? '',
        valence: data.extracted_data?.valence ?? '',
        speechAct: data.extracted_data?.speech_act ?? '',
        timestamp: Date.now(),
      };
      sessionHistory.unshift(item);
      renderHistory();
      renderEngine();
    } catch {
      // non-fatal
    }
  } catch (error) {
    console.error('[Lyra] Translation failed:', error);
    renderOutput(t('status.failed'), { isPlaceholder: true });
  } finally {
    setLoading(false);
  }
}

async function copyOutputText() {
  const outputs = getOutputElements();
  const output = outputs.find((el) => el.textContent?.trim()) || outputs[0];
  if (!output) return;

  const text = output.textContent?.trim();
  if (!text) return;

  const blockedMessages = [t('status.awaiting'), t('status.emptySource'), t('status.failed')];
  if (blockedMessages.some((message) => text.includes(message))) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    fallback.style.pointerEvents = 'none';
    fallback.style.left = '-9999px';
    document.body.appendChild(fallback);
    fallback.select();
    fallback.setSelectionRange(0, fallback.value.length);

    const copied = document.execCommand('copy');
    fallback.remove();

    if (!copied) {
      throw new Error('Fallback copy failed');
    }
  } catch (error) {
    console.error('[Lyra] Copy failed:', error);
  }
}

function initCopyButton() {
  ['copy-btn', 'copy-btn-mobile'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', copyOutputText);
  });
}

function formatTime(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

function formatDate(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;

  if (sessionHistory.length === 0) {
    list.innerHTML = `
      <div class="col-span-full flex items-center justify-center py-12 text-outline">
        <div class="text-center max-w-md">
          <span class="material-symbols-outlined text-[40px] mb-3 text-white/15">history</span>
          <p class="font-body-md">${t('history.empty')}</p>
        </div>
      </div>`;
    return;
  }

  list.innerHTML = sessionHistory
    .map((item) => {
      const date = formatDate(item.timestamp);
      const time = formatTime(item.timestamp);
      const snippet =
        item.source.length > 160 ? `${item.source.slice(0, 157)}…` : item.source;

      return `
        <article class="bento-card p-4 flex flex-col gap-3">
          <header class="flex items-center justify-between gap-3">
            <div class="text-xs uppercase tracking-[0.22em] text-outline">
              ${date ? `${date} · ` : ''}${time}
            </div>
            <div class="flex gap-2 text-[11px] uppercase tracking-[0.16em] text-outline">
              <span class="px-2 py-1 rounded-full bg-surface-container-high/50 border border-outline-variant/20">${item.targetLanguage}</span>
              <span class="px-2 py-1 rounded-full bg-surface-container-high/50 border border-outline-variant/20">${item.persona}</span>
            </div>
          </header>
          <div class="text-xs text-outline/80 line-clamp-3">${snippet}</div>
          <div class="border-t border-outline-variant/10 pt-3 mt-1">
            <div class="text-[11px] uppercase tracking-[0.18em] text-primary mb-1">${t('history.output')}</div>
            <p class="text-sm text-on-surface leading-relaxed line-clamp-3">${item.output}</p>
          </div>
        </article>`;
    })
    .join('');
}

function renderEngine() {
  const empty = document.getElementById('engine-empty');
  const container = document.getElementById('engine-content');
  if (!empty || !container) return;

  if (!lastEnginePayload) {
    empty.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  const core = document.getElementById('engine-core-meaning');
  const valenceLabel = document.getElementById('engine-valence-label');
  const valenceBar = document.getElementById('engine-valence-bar');
  const valenceIcon = document.getElementById('engine-valence-icon');
  const speechAct = document.getElementById('engine-speech-act');
  const entities = document.getElementById('engine-entities');

  const extracted = lastEnginePayload.extracted_data || {};

  if (core) {
    core.textContent = extracted.core_meaning || t('engine.noCore');
  }

  if (valenceLabel && valenceBar && valenceIcon) {
    const rawValence = (extracted.valence || '').toString().toLowerCase();
    let label = extracted.valence || 'Neutral';
    let percent = 50;
    let icon = 'mood';

    if (rawValence.includes('positive')) {
      percent = 78;
      icon = 'sentiment_satisfied';
    } else if (rawValence.includes('negative')) {
      percent = 24;
      icon = 'sentiment_dissatisfied';
    } else if (rawValence.includes('mixed')) {
      percent = 55;
      icon = 'sentiment_neutral';
    }

    valenceLabel.textContent = label;
    valenceBar.style.width = `${percent}%`;
    valenceIcon.textContent = icon;
  }

  if (speechAct) {
    speechAct.textContent = extracted.speech_act || t('engine.noSpeechAct');
  }

  if (entities) {
    const entitiesText =
      extracted.entities && extracted.entities !== 'none'
        ? extracted.entities
        : t('engine.noEntities');
    entities.textContent = entitiesText;
  }

  empty.classList.add('hidden');
  container.classList.remove('hidden');
}

function setActiveSection(section) {
  appState.activeSection = section;

  const sections = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.app-section')
  );
  sections.forEach((el) => {
    if (!el.id) return;
    const idSection = el.id.replace('section-', '');
    el.classList.toggle('hidden', idSection !== section);
    el.classList.toggle('is-active', idSection === section);
  });

  const navItems = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.nav-item')
  );
  navItems.forEach((btn) => {
    const btnSection = btn.dataset.section;
    const active = btnSection === section;

    btn.classList.toggle('is-active', active);
    btn.classList.toggle('text-primary', active);
    btn.classList.toggle('font-bold', active);
    btn.classList.toggle('text-outline', !active);
  });

  const mobileItems = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.mobile-nav-item[data-section]')
  );
  mobileItems.forEach((btn) => {
    const btnSection = btn.dataset.section;
    const label = btn.querySelector('span:last-child');
    const icon = btn.querySelector('.material-symbols-outlined');
    const active = btnSection === section;
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('text-primary', active);
    btn.classList.toggle('text-outline', !active);
    if (label) {
      label.classList.toggle('text-primary', active);
      label.classList.toggle('text-outline', !active);
    }
    if (icon instanceof HTMLElement) {
      icon.style.fontVariationSettings = active ? "'FILL' 1" : "'FILL' 0";
    }
  });

  const translateControls = document.querySelectorAll('.translate-controls');
  const isTranslate = section === 'translate';
  translateControls.forEach((el) => {
    el.classList.toggle('translate-controls--visible', isTranslate);
  });

  const mobileNav = document.getElementById('mobile-bottom-nav');
  const mainCanvas = document.getElementById('main-canvas');
  if (mobileNav) {
    // Keep the mobile bottom nav near the bottom; translate controls will float above it.
    mobileNav.style.bottom = 'calc(12px + env(safe-area-inset-bottom))';
  }
  // Move mobile translate controls above the bottom nav when Translate is active
  const translateControlsMobile = document.getElementById('translate-controls-mobile');
  if (mainCanvas) {
    mainCanvas.classList.toggle('pb-36', !isTranslate);
    mainCanvas.classList.toggle('pb-52', isTranslate);
  }

  syncMobileNavIndicator(section);

  if (section === 'history') {
    renderHistory();
  } else if (section === 'engine') {
    renderEngine();
  }
}

function syncMobileNavIndicator(section) {
  const mobileNav = document.getElementById('mobile-bottom-nav');
  const indicator = document.getElementById('mobile-nav-indicator');
  if (!mobileNav || !indicator) return;

  const activeButton = mobileNav.querySelector(`.mobile-nav-item[data-section="${section}"]`);
  if (!(activeButton instanceof HTMLElement)) {
    indicator.style.opacity = '0';
    return;
  }

  const navRect = mobileNav.getBoundingClientRect();
  const buttonRect = activeButton.getBoundingClientRect();
  const insetX = 8;
  const insetY = 6;

  indicator.style.width = `${buttonRect.width + insetX * 2}px`;
  indicator.style.height = `${buttonRect.height + insetY * 2}px`;
  indicator.style.transform = `translate(${buttonRect.left - navRect.left - insetX}px, ${buttonRect.top - navRect.top - insetY}px)`;
  indicator.style.opacity = '1';
}

function applyTheme(theme) {
  appState.theme = theme;
  document.body.dataset.theme = theme;

  document.querySelectorAll('#theme-options .theme-option').forEach((btn) => {
    const isActive = btn.getAttribute('data-theme') === theme;
    btn.classList.toggle('is-active', isActive);
  });
}

function updateToggleThumb(thumbId, enabled) {
  const thumb = document.getElementById(thumbId);
  if (!thumb) return;
  thumb.textContent = enabled ? t('settings.on') : t('settings.off');
  thumb.classList.toggle('is-on', enabled);
}

function applyEffects(enabled) {
  appState.effectsEnabled = enabled;
  document.body.dataset.effects = enabled ? 'on' : 'off';
  updateToggleThumb('effects-toggle-thumb', enabled);
}

function captureBackgroundFrame() {
  const video = document.getElementById('bg-video');
  const gif = document.getElementById('bg-gif');
  const freeze = document.getElementById('bg-freeze');
  const fallback = document.getElementById('bg-fallback');
  if (!freeze) return false;
  // Try video first if it's available (regardless of 'is-active' class)
  try {
    if (video && video.videoWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        freeze.src = canvas.toDataURL('image/jpeg', 0.9);
        // Ensure the live media is visually deactivated
        try { video.pause(); } catch (e) {}
        video.classList.remove('is-active');
        gif?.classList.remove('is-active');
        freeze.classList.remove('hidden');
        freeze.classList.add('is-active');
        fallback?.classList.add('is-hidden');
        return true;
      }
    }
  } catch (e) {
    // ignore canvas errors
  }

  // Fallback to GIF if available
  if (gif && gif.complete && gif.naturalWidth > 0) {
    freeze.src = gif.src;
    gif.classList.remove('is-active');
    freeze.classList.remove('hidden');
    freeze.classList.add('is-active');
    fallback?.classList.add('is-hidden');
    return true;
  }

  return false;
}

function applyDynamicBackground(enabled) {
  appState.dynamicBackground = enabled;
  const video = document.getElementById('bg-video');
  const gif = document.getElementById('bg-gif');
  const freeze = document.getElementById('bg-freeze');
  const fallback = document.getElementById('bg-fallback');

  updateToggleThumb('background-toggle-thumb', enabled);

  if (!enabled) {
    // Try to freeze the current frame; if not possible, show the fluid fallback
    const froze = captureBackgroundFrame();
    if (!froze) {
      // If no frame could be captured, show animated blobs as gentle fallback
      fallback?.classList.remove('is-hidden');
      // hide any active media
      try { video?.pause(); } catch (e) {}
      video?.classList.remove('is-active');
      gif?.classList.remove('is-active');
      freeze?.classList.remove('is-active');
      freeze?.classList.add('hidden');
    }
    return;
  }

  freeze?.classList.add('hidden');
  freeze?.classList.remove('is-active');

  if (video && !video.error) {
    // Attempt to play the video; if that fails, fall back to GIF or blobs
    video.play().then(() => {
      video.classList.add('is-active');
      fallback?.classList.add('is-hidden');
      gif?.classList.remove('is-active');
    }).catch(() => {
      if (gif && gif.complete && gif.naturalWidth > 0) {
        gif.classList.add('is-active');
        fallback?.classList.add('is-hidden');
      } else {
        fallback?.classList.remove('is-hidden');
      }
    });
  } else if (gif?.complete && gif.naturalWidth > 0) {
    gif.classList.add('is-active');
    fallback?.classList.add('is-hidden');
  } else {
    fallback?.classList.remove('is-hidden');
  }
}

function applyLanguage(lang) {
  if (!(lang in UI_COPY)) lang = 'en';
  appState.uiLanguage = lang;
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      el.placeholder = t(key);
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });

  document.querySelectorAll('.ui-lang-option').forEach((btn) => {
    const isActive = btn.getAttribute('data-lang') === lang;
    btn.classList.toggle('aurora-ring--active', isActive);
    btn.classList.toggle('is-active', isActive);
  });

  updateToggleThumb('effects-toggle-thumb', appState.effectsEnabled);
  updateToggleThumb('background-toggle-thumb', appState.dynamicBackground);

  const synthesizeBtn = document.getElementById('synthesize-btn');
  if (synthesizeBtn && !synthesizeBtn.classList.contains('is-loading')) {
    const label = document.getElementById('synthesize-label');
    if (label) label.textContent = t('action.synthesize');
  }

  renderHistory();
  renderEngine();
}

function initBackground() {
  const fallback = document.getElementById('bg-fallback');
  const video = document.getElementById('bg-video');
  const gif = document.getElementById('bg-gif');

  const activateMedia = (element) => {
    element?.classList.remove('hidden');
    element?.classList.add('is-active');
    fallback?.classList.add('is-hidden');
  };

  if (video) {
    video.addEventListener('canplay', () => activateMedia(video));
    video.addEventListener('error', () => {
      if (gif?.complete && gif.naturalWidth > 0) {
        activateMedia(gif);
      }
    });
    video.load();
  }

  if (gif) {
    gif.addEventListener('load', () => {
      if (!video?.classList.contains('is-active')) {
        activateMedia(gif);
      }
    });
    gif.addEventListener('error', () => {
      gif.style.display = 'none';
    });
  }
}

// ============================================================================
// TRAVELER MODE HANDLERS
// ============================================================================

async function handleImageSelect(file) {
  if (!file) return;

  resetTravelerFlow();

  try {
    const compressedBlob = await compressTravelerImage(file);
    travelerCurrentImage = compressedBlob;
    clearTravelerPreviewUrl();
    travelerCurrentImagePreviewUrl = URL.createObjectURL(compressedBlob);

    const preview = document.getElementById('image-preview');
    const container = document.getElementById('image-preview-container');
    if (preview && container) {
      preview.src = travelerCurrentImagePreviewUrl;
      container.classList.remove('hidden');
    }

    const applyBtn = document.getElementById('apply-translation-btn');
    if (applyBtn) {
      applyBtn.classList.remove('hidden');
      applyBtn.disabled = false;
      setTravelerButtonLabel(applyBtn, 'Apply Quick Translation');
    }
  } catch (error) {
    console.error('[Lyra Traveler] Image compression failed:', error);

    travelerCurrentImage = null;
    clearTravelerPreviewUrl();

    const reader = new FileReader();
    reader.onload = (e) => {
      travelerCurrentImage = e.target.result;
      const preview = document.getElementById('image-preview');
      const container = document.getElementById('image-preview-container');
      if (preview && container) {
        preview.src = travelerCurrentImage;
        container.classList.remove('hidden');
      }

      const applyBtn = document.getElementById('apply-translation-btn');
      if (applyBtn) {
        applyBtn.classList.remove('hidden');
        applyBtn.disabled = false;
        setTravelerButtonLabel(applyBtn, 'Apply Quick Translation');
      }
    };
    reader.readAsDataURL(file);
  }
}

async function getTravelerUploadBlob() {
  if (!travelerCurrentImage) return null;

  if (travelerCurrentImage instanceof Blob) {
    return travelerCurrentImage;
  }

  if (typeof travelerCurrentImage === 'string' && travelerCurrentImage.startsWith('data:')) {
    const arr = travelerCurrentImage.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  }

  return null;
}

function setTravelerTranslationLoading(isLoading) {
  const applyBtn = document.getElementById('apply-translation-btn');
  const translationCard = document.getElementById('traveler-translation-card');
  const translationText = document.getElementById('traveler-translation');
  const discoverBtn = document.getElementById('discover-context-btn');

  if (translationCard) translationCard.classList.remove('hidden');
  if (translationText) {
    translationText.textContent = isLoading ? 'Translating...' : getTravelerTranslationDisplayText();
  }
  if (applyBtn) {
    applyBtn.disabled = isLoading;
    setTravelerButtonLabel(applyBtn, isLoading ? 'Translating...' : 'Apply Quick Translation');
  }
  if (discoverBtn) {
    discoverBtn.classList.toggle('hidden', isLoading || !travelerCurrentTranslation);
    discoverBtn.disabled = isLoading;
    setTravelerButtonLabel(discoverBtn, 'Discover Context');
  }
}

async function translateTravelerImage() {
  const blob = await getTravelerUploadBlob();
  if (!blob) return;

  const language = document.getElementById('traveler-language').value || 'English';
  const mode = document.getElementById('traveler-mode').value || 'object';

  setTravelerTranslationLoading(true);

  try {
    const formData = new FormData();
    formData.append('image', blob, 'photo.jpg');
    formData.append('target_language', language);
    formData.append('mode', mode);

    console.log('[Lyra Traveler] Sending translation request to:', getTravelerTranslationUrl())
    console.log('[Lyra Traveler] Translation request:', { language, mode, imageSize: blob?.size });

    const response = await fetch(getTravelerTranslationUrl(), {
      method: 'POST',
      headers: {
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: formData,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Backend error (HTTP ${response.status}): ${text.substring(0, 100)}`);
    }

    const data = await response.json();

    if (!response.ok || data.status === 'error') {
      throw new Error(data.message || 'Translation failed');
    }

    travelerCurrentTranslation = data.translation || 'NO_TEXT_FOUND';
    const translationText = document.getElementById('traveler-translation');
    if (translationText) {
      translationText.textContent = getTravelerTranslationDisplayText();
    }

    const discoverBtn = document.getElementById('discover-context-btn');
    if (discoverBtn) {
      discoverBtn.classList.remove('hidden');
      discoverBtn.disabled = false;
    }
  } catch (error) {
    console.error('[Lyra Traveler] Translation failed:', error);
    travelerCurrentTranslation = '';

    const translationText = document.getElementById('traveler-translation');
    if (translationText) {
      translationText.textContent = 'Translation failed. Try another photo.';
    }

    const discoverBtn = document.getElementById('discover-context-btn');
    if (discoverBtn) {
      discoverBtn.classList.add('hidden');
      discoverBtn.disabled = true;
    }
  } finally {
    setTravelerTranslationLoading(false);
  }
}

async function analyzeTravelerImage() {
  if (!travelerCurrentImage) return;

  const language = document.getElementById('traveler-language').value || 'English';
  const mode = document.getElementById('traveler-mode').value || 'object';
  const analyzeBtn = document.getElementById('discover-context-btn');

  if (!analyzeBtn) return;
  analyzeBtn.disabled = true;
  setTravelerButtonLabel(analyzeBtn, 'Discovering...');

  try {
    const blob = await getTravelerUploadBlob();
    if (!blob) {
      throw new Error('No image available');
    }

    const formData = new FormData();
    formData.append('image', blob, 'photo.jpg');
    formData.append('target_language', language);
    formData.append('mode', mode);

    console.log('[Lyra Traveler] Sending request to:', TRAVELER_ANALYZE_URL);
    console.log('[Lyra Traveler] FormData:', { language, mode, imageSize: blob?.size });

    const response = await fetch(getTravelerAnalyzeUrl(), {
      method: 'POST',
      // localtunnel sometimes shows a landing page; send this header to bypass the reminder
      headers: {
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: formData,
    });

    // Debug: log response status and content type
    console.log('[Lyra Traveler] Response status:', response.status);
    console.log('[Lyra Traveler] Response headers:', {
      'content-type': response.headers.get('content-type'),
      'server': response.headers.get('server'),
    });

    // Check if response is actually JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('[Lyra Traveler] Non-JSON response received:');
      console.error('[Lyra Traveler] Status:', response.status);
      console.error('[Lyra Traveler] First 300 chars:', text.substring(0, 300));
      
      if (response.status === 511) {
        throw new Error('Backend not responding on port 8000. Check Kaggle notebook is running FastAPI on port 8000 and localtunnel is active.');
      }
      throw new Error(`Backend error (HTTP ${response.status}): ${text.substring(0, 100)}`);
    }

    const data = await response.json();

    if (!response.ok || data.status === 'error') {
      throw new Error(data.message || 'Analysis failed');
    }

    // Display results
    displayTravelerResults(data);
    await loadTravelerHistory();
  } catch (error) {
    console.error('[Lyra Traveler] Analysis failed:', error);
    alert('Analysis failed: ' + error.message);
  } finally {
    analyzeBtn.disabled = false;
    setTravelerButtonLabel(analyzeBtn, 'Discover Context');
  }
}

function displayTravelerTranslation(data) {
  const translationCard = document.getElementById('traveler-translation-card');
  const translationText = document.getElementById('traveler-translation');
  const discoverBtn = document.getElementById('discover-context-btn');

  if (translationCard) translationCard.classList.remove('hidden');
  if (translationText) {
    travelerCurrentTranslation = data.translation || 'NO_TEXT_FOUND';
    translationText.textContent = getTravelerTranslationDisplayText();
  }
  if (discoverBtn) {
    discoverBtn.classList.remove('hidden');
    discoverBtn.disabled = false;
  }
}

function displayTravelerResults(data) {
  const resultsDiv = document.getElementById('traveler-results');
  const explanationDiv = document.getElementById('traveler-explanation');
  const safetyBanner = document.getElementById('safety-flag-banner');
  const safetyTitle = document.getElementById('safety-flag-title');
  const safetyText = document.getElementById('safety-flag-text');
  const ttsControls = document.getElementById('tts-controls');
  const playBtn = document.getElementById('play-audio-btn');
  const audio = document.getElementById('traveler-audio');

  if (!resultsDiv) return;

  // Show results section
  resultsDiv.classList.remove('hidden');

  // Display explanation
  if (explanationDiv) {
    explanationDiv.textContent = data.explanation;
  }

  // Handle safety flag (be defensive if backend didn't include the field)
  const safetyFlag = (data && data.safety_flag) ? data.safety_flag : 'none';
  if (safetyBanner && safetyFlag !== 'none') {
    safetyBanner.classList.remove('hidden');
    if (safetyTitle) {
      safetyTitle.textContent = safetyFlag === 'urgent' ? '⚠️ Urgent Warning' : '⚠️ Warning';
    }
    if (safetyText) {
      safetyText.textContent = `This item flagged as ${safetyFlag}. Review the explanation carefully.`;
    }
  } else if (safetyBanner) {
    safetyBanner.classList.add('hidden');
  }

  // Handle TTS audio
  if (data.audio_url && ttsControls && audio) {
    ttsControls.classList.remove('hidden');
    audio.src = data.audio_url;
    if (playBtn) {
      playBtn.onclick = () => {
        if (audio.paused) {
          audio.play();
          playBtn.textContent = 'Stop Audio';
        } else {
          audio.pause();
          audio.currentTime = 0;
          playBtn.textContent = 'Play Audio';
        }
      };
    }
  } else if (ttsControls) {
    ttsControls.classList.add('hidden');
  }
}

async function loadTravelerHistory() {
  try {
    const response = await fetch(getTravelerHistoryUrl(), {
      headers: {
        'Bypass-Tunnel-Reminder': 'true'
      }
    });
    const data = await response.json();

    if (data.status !== 'success') return;

    travelerHistory = data.history || [];
    renderTravelerHistory();
  } catch (error) {
    console.error('[Lyra Traveler] Failed to load history:', error);
  }
}

function renderTravelerHistory() {
  const historyList = document.getElementById('traveler-history-list');
  if (!historyList) return;

  if (travelerHistory.length === 0) {
    historyList.innerHTML = `
      <div class="text-center py-8 text-outline">
        <span class="material-symbols-outlined text-[40px] mb-3 text-white/15 block">image_search</span>
        <p class="font-body-md">No captures yet. Start by uploading an image.</p>
      </div>`;
    return;
  }

  historyList.innerHTML = travelerHistory
    .slice()
    .reverse()
    .map((item) => {
      const ts = new Date(item.timestamp).toLocaleString();
      const itemSafety = item && item.safety_flag ? item.safety_flag : 'none';
      const safetyColor = itemSafety === 'urgent' ? '#ffb4ab' : itemSafety === 'warning' ? '#ff9800' : '#4caf50';
      return `
        <div class="bento-card p-4 flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-label-md text-label-md text-on-surface">${item.language} • ${item.mode}</p>
              <p class="font-body-md text-outline text-xs mt-1">${ts}</p>
            </div>
            <span class="px-2 py-1 rounded-full text-xs font-semibold" style="color: ${safetyColor}; background: rgba(255,180,170,0.1);">
              ${itemSafety === 'urgent' ? '🚨 Urgent' : itemSafety === 'warning' ? '⚠️ Warning' : '✓ OK'}
            </span>
          </div>
          <p class="font-body-md text-on-surface leading-relaxed text-sm line-clamp-3">${item.explanation}</p>
          ${item.has_audio ? '<p class="text-primary text-xs flex items-center gap-1"><span class="material-symbols-outlined text-sm">volume_up</span> Audio available</p>' : ''}
        </div>`;
    })
    .join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const targetLanguage = document.getElementById('target-language');
  const persona = document.getElementById('persona');
  const targetLanguageMobile = document.getElementById('target-language-mobile');
  const personaMobile = document.getElementById('persona-mobile');

  if (targetLanguage) targetLanguage.value = DEFAULT_LANGUAGE;
  if (persona) persona.value = DEFAULT_PERSONA;
  if (targetLanguageMobile) targetLanguageMobile.value = DEFAULT_LANGUAGE;
  if (personaMobile) personaMobile.value = DEFAULT_PERSONA;

  syncField('source-text', 'source-text-mobile');
  syncField('target-language', 'target-language-mobile');
  syncField('persona', 'persona-mobile');

  initAutocomplete('target-language', 'language-suggestions', LANGUAGE_SUGGESTIONS);
  initAutocomplete('persona', 'persona-suggestions', PERSONA_SUGGESTIONS);
  initAutocomplete('target-language-mobile', 'language-suggestions-mobile', LANGUAGE_SUGGESTIONS);
  initAutocomplete('persona-mobile', 'persona-suggestions-mobile', PERSONA_SUGGESTIONS);

  document.getElementById('synthesize-btn')?.addEventListener('click', synthesize);
  document.getElementById('synthesize-btn-mobile')?.addEventListener('click', synthesize);

  // ===== TRAVELER MODE HANDLERS =====
  document.getElementById('upload-image-btn')?.addEventListener('click', () => {
    document.getElementById('image-file-input')?.click();
  });

  document.getElementById('image-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleImageSelect(file);
  });

  document.getElementById('camera-capture-btn')?.addEventListener('click', () => {
    document.getElementById('image-camera-input')?.click();
  });

  document.getElementById('camera-capture-btn-mobile')?.addEventListener('click', () => {
    document.getElementById('image-camera-input')?.click();
  });

  document.getElementById('image-camera-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleImageSelect(file);
  });

  document.getElementById('clear-image-btn')?.addEventListener('click', () => {
    travelerCurrentImage = null;
    clearTravelerPreviewUrl();
    document.getElementById('image-preview-container')?.classList.add('hidden');
    resetTravelerFlow();
  });

  document.getElementById('apply-translation-btn')?.addEventListener('click', translateTravelerImage);
  document.getElementById('discover-context-btn')?.addEventListener('click', analyzeTravelerImage);

  // Mobile mic button placeholder
  document.getElementById('mic-btn-mobile')?.addEventListener('click', () => {
    console.log('[Lyra] mic button clicked (mobile)');
    // TODO: integrate Web Speech API or custom recording flow here
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.target.closest('.autocomplete-wrapper')) {
      document.querySelectorAll('.autocomplete-list').forEach((list) => {
        list.classList.add('hidden');
      });
      activeAutocomplete = null;
    }
  });

  initCopyButton();
  initBackground();

  // Navigation wiring
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((el) => {
    el.addEventListener('click', () => {
      const section = el.getAttribute('data-section') || 'translate';
      setActiveSection(section);
    });
  });

  const mobileItems = document.querySelectorAll('.mobile-nav-item');
  mobileItems.forEach((el) => {
    el.addEventListener('click', () => {
      const section = el.getAttribute('data-section') || 'translate';
      setActiveSection(section);
    });
  });

  window.addEventListener('resize', () => {
    syncMobileNavIndicator(appState.activeSection);
  });

  // History clear
  const clearBtn = document.getElementById('history-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      sessionHistory.length = 0;
      renderHistory();
    });
  }

  // Theme + effects + language
  document
    .querySelectorAll('#theme-options .theme-option')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme') || 'cosmic';
        applyTheme(theme);
      });
    });

  const effectsToggle = document.getElementById('effects-toggle');
  if (effectsToggle) {
    effectsToggle.addEventListener('click', () => {
      applyEffects(!appState.effectsEnabled);
    });
  }

  const backgroundToggle = document.getElementById('background-toggle');
  if (backgroundToggle) {
    backgroundToggle.addEventListener('click', () => {
      applyDynamicBackground(!appState.dynamicBackground);
    });
  }

  document.querySelectorAll('.ui-lang-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang') || 'en';
      applyLanguage(lang);
    });
  });

  // Initial state
  applyTheme(appState.theme);
  applyEffects(appState.effectsEnabled);
  applyDynamicBackground(appState.dynamicBackground);
  applyLanguage(appState.uiLanguage);
  setActiveSection(appState.activeSection);

  // Load traveler history on startup
  loadTravelerHistory();
  // API URL ayar ekranı
  const apiUrlInput = document.getElementById('api-base-url-input');
  const apiUrlSaveBtn = document.getElementById('api-base-url-save-btn');
  const apiUrlStatus = document.getElementById('api-base-url-status');

  if (apiUrlInput) {
    apiUrlInput.value = getApiBase();
  }

  if (apiUrlSaveBtn) {
    apiUrlSaveBtn.addEventListener('click', () => {
      const value = apiUrlInput.value.trim();
      if (!value) return;
      setApiBase(value);
      if (apiUrlStatus) {
        apiUrlStatus.textContent = 'Kaydedildi ✓';
        apiUrlStatus.classList.remove('hidden');
        setTimeout(() => apiUrlStatus.classList.add('hidden'), 2000);
      }
    });
  }
});
