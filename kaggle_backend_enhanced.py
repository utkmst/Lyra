import os
import gc
import torch
import base64
import json
import nest_asyncio
import uvicorn
import subprocess
import urllib.request
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from huggingface_hub import login
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser
from langchain_core.messages import HumanMessage
from kaggle_secrets import UserSecretsClient
from langchain_google_genai import ChatGoogleGenerativeAI
import re

# ============================================================================
# SETUP: Secrets & API
# ============================================================================
user_secrets = UserSecretsClient()
gemini_api_key = user_secrets.get_secret("GEMINI_API_KEY")

# Optional: TTS via Google Cloud Text-to-Speech (requires GOOGLE_APPLICATION_CREDENTIALS)
# For now, we'll use a simple flag and optional integration point
try:
    from google.cloud import texttospeech
    HAS_TTS = True
except ImportError:
    HAS_TTS = False
    print("[Warning] google-cloud-texttospeech not installed. TTS will be skipped.")

# ============================================================================
# 1. FastAPI Setup
# ============================================================================
app = FastAPI(title="Kültürel Yerelleştirme API v2 (with TTS & History)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# 2. In-Memory Stores (Ephemeral; resets on server restart)
# ============================================================================
class HistoryEntry(BaseModel):
    id: str
    timestamp: str
    image_mode: str
    target_language: str
    explanation: str
    safety_flag: str  # "none", "warning", "urgent"
    audio_url: str = None  # Optional MP3 data URL

analysis_history = []  # List of HistoryEntry

class TranslateRequest(BaseModel):
    text: str
    target_language: str
    persona: str

# ============================================================================
# 3. LangChain Setup (Text mode)
# ============================================================================
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=gemini_api_key)

class SemanticFrame(BaseModel):
    core_meaning: str = Field(description="The pure propositional content. DO NOT literally translate idioms, metaphors, or slang. Extract their actual underlying factual meaning in plain, boring English.")
    speech_act: str = Field(description="e.g. request, complaint, compliment, apology, statement")
    entities: str = Field(description="Key named entities or referents, comma-separated, or 'none'")
    valence: str = Field(description="Emotional tone of the original: e.g. positive, neutral, frustrated, excited")

extract_parser = JsonOutputParser(pydantic_object=SemanticFrame)

extract_template = """<|im_start|>system
You decompose text into a register-neutral semantic frame. Strip away HOW it was said and capture only WHAT was communicated: the core proposition, the speech act being performed, key entities, and emotional valence. Do not translate or restyle anything yet.
CRITICAL INSTRUCTION: You MUST output ONLY valid JSON. Do not write any other text, no greetings, no explanations. 
{format_instructions}<|im_end|>
<|im_start|>user
Text: {text}<|im_end|>
<|im_start|>assistant
"""

extract_prompt = PromptTemplate(
    template=extract_template,
    input_variables=["text"],
    partial_variables={"format_instructions": extract_parser.get_format_instructions()},
)

json_chain = extract_prompt | llm | extract_parser

# --- LANGCHAIN AŞAMA 2 ---
render_template = """<|im_start|>system
You are a master of sociolinguistics, localization, and creative writing.
Reconstruct the following semantic frame into {target_language}.

SEMANTIC FRAME TO RENDER:
Core meaning: {core_meaning},
Speech act: {speech_act},
Entities: {entities},
Emotion: {valence}

PERSONA:
persona: {persona}

CRITICAL INSTRUCTION: Do NOT translate literally. Write a completely natural, single utterance in {target_language} that fits the persona perfectly. Do not add any explanations, notes, or quotation marks. Just the spoken text itself.<|im_end|>
<|im_start|>user
Render the text.<|im_end|>
<|im_start|>assistant
"""

render_prompt = PromptTemplate(
    template=render_template,
    input_variables=["target_language", "core_meaning", "speech_act", "entities", "valence", "persona"]
)

render_chain = render_prompt | llm | StrOutputParser()

# ============================================================================
# 4. Vision/Traveler Setup
# ============================================================================
traveler_llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0.3,
    google_api_key=gemini_api_key
)

def build_traveler_prompt(target_language: str, mode: str) -> str:
    mode_hints = {
        "menu": "This is likely a restaurant menu. Mention any allergens or unusual ingredients you notice.",
        "sign": "This is likely a sign or notice. Flag if it's a warning, rule, or safety instruction.",
        "product": "This is likely a product label. Mention price, quantity, or usage instructions if visible.",
        "object": "This is a general object or scene the traveler is curious about.",
        "currency": "This is money or a price. Explain the value in context and any warnings about counterfeits.",
    }
    hint = mode_hints.get(mode, mode_hints["object"])
    return f"""You are a patient local friend helping a traveler who doesn't speak the language.
Look at the image. {hint}
Explain what it is and what it means in {target_language}, in simple, warm, non-technical language.
If there's text in the image, tell them what it says AND what it means practically for them.
Do not use jargon. Keep it short — 2-4 sentences.
If anything looks like a warning or safety issue, say so clearly at the start."""

def detect_safety_flag(text: str) -> str:
    """
    Simple heuristic to detect urgency/safety flags in the explanation.
    Returns: 'urgent', 'warning', or 'none'
    """
    urgent_keywords = [
        r'\bpoison\b', r'\btoxic\b', r'\bdanger\b', r'\bclosed\b', r'\bdo not\b',
        r'\b⚠️\b', r'\bbeware\b', r'\bbanned\b', r'\bforbidden\b', r'\billegal\b',
        r'\bemergency\b', r'\bcaution\b', r'\brecall\b'
    ]
    warning_keywords = [
        r'\bwarning\b', r'\bexpired\b', r'\bnot recommended\b', r'\bask before\b',
        r'\ballergen\b', r'\bcontains\b', r'\bavoid\b', r'\bcareful\b'
    ]
    
    text_lower = text.lower()
    
    for pattern in urgent_keywords:
        if re.search(pattern, text_lower):
            return "urgent"
    
    for pattern in warning_keywords:
        if re.search(pattern, text_lower):
            return "warning"
    
    return "none"

def generate_tts_audio(text: str, language_code: str = "en-US") -> str:
    """
    Convert text to speech using Google Cloud TTS.
    Returns base64-encoded MP3 data URL, or None if TTS unavailable.
    
    Language code examples: "en-US", "tr-TR", "ja-JP", "fr-FR"
    """
    if not HAS_TTS:
        return None
    
    try:
        client = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(language_code=language_code)
        audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
        
        response = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
        
        # Encode to base64 data URL
        audio_b64 = base64.b64encode(response.audio_content).decode("utf-8")
        return f"data:audio/mp3;base64,{audio_b64}"
    except Exception as e:
        print(f"[TTS Error] {e}")
        return None

# ============================================================================
# 5. API Endpoints
# ============================================================================

@app.post("/translate")
async def process_translation(req: TranslateRequest):
    """Text mode: extract semantics, then render in target language + persona."""
    try:
        # 1. Aşama: Orijinal metni JSON'a çevir
        data = json_chain.invoke({"text": req.text})
        
        # 2. Aşama: Yeni persona ve dilde sentezle
        render_conclusion = render_chain.invoke({
            "target_language": req.target_language,
            "persona": req.persona,
            **data
        })
        
        return {
            "status": "success",
            "original_text": req.text,
            "extracted_data": data,
            "final_translation": render_conclusion
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": str(e)}
        )

@app.post("/traveler/analyze")
async def traveler_analyze(
    image: UploadFile = File(...),
    target_language: str = Form(...),
    mode: str = Form("object")
):
    """
    Vision mode: analyze image, explain in target language, detect safety flags, optionally generate TTS.
    """
    try:
        image_bytes = await image.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = image.content_type or "image/jpeg"

        prompt_text = build_traveler_prompt(target_language, mode)

        message = HumanMessage(content=[
            {"type": "text", "text": prompt_text},
            {"type": "image_url", "image_url": f"data:{mime_type};base64,{image_b64}"}
        ])

        response = traveler_llm.invoke([message])
        explanation = response.content

        # Detect safety flags
        safety_flag = detect_safety_flag(explanation)

        # Generate TTS (optional, language-specific)
        language_code_map = {
            "Turkish": "tr-TR",
            "English": "en-US",
            "Japanese": "ja-JP",
            "French": "fr-FR",
            "Spanish": "es-ES",
            "German": "de-DE",
            "Chinese": "zh-CN",
            "Arabic": "ar-SA",
        }
        lang_code = language_code_map.get(target_language, "en-US")
        audio_url = generate_tts_audio(explanation, lang_code) if HAS_TTS else None

        # Create history entry
        entry = HistoryEntry(
            id=f"traveler_{int(datetime.now().timestamp() * 1000)}",
            timestamp=datetime.now().isoformat(),
            image_mode=mode,
            target_language=target_language,
            explanation=explanation,
            safety_flag=safety_flag,
            audio_url=audio_url
        )
        analysis_history.append(entry)

        # Keep last 50 entries to avoid memory bloat
        if len(analysis_history) > 50:
            analysis_history.pop(0)

        return {
            "status": "success",
            "mode": mode,
            "target_language": target_language,
            "explanation": explanation,
            "safety_flag": safety_flag,
            "audio_url": audio_url,
            "entry_id": entry.id
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": str(e)}
        )

@app.get("/traveler/history")
async def get_history(limit: int = 20):
    """Retrieve capture history (last N entries)."""
    recent = analysis_history[-limit:]
    return {
        "status": "success",
        "count": len(recent),
        "history": [
            {
                "id": e.id,
                "timestamp": e.timestamp,
                "mode": e.image_mode,
                "language": e.target_language,
                "explanation": e.explanation,
                "safety_flag": e.safety_flag,
                "has_audio": e.audio_url is not None
            }
            for e in recent
        ]
    }

@app.get("/traveler/history/{entry_id}")
async def get_history_entry(entry_id: str):
    """Retrieve a specific history entry (e.g., to replay audio)."""
    for entry in analysis_history:
        if entry.id == entry_id:
            return {
                "status": "success",
                "entry": {
                    "id": entry.id,
                    "timestamp": entry.timestamp,
                    "mode": entry.image_mode,
                    "language": entry.target_language,
                    "explanation": entry.explanation,
                    "safety_flag": entry.safety_flag,
                    "audio_url": entry.audio_url
                }
            }
    return JSONResponse(
        status_code=404,
        content={"status": "error", "message": "Entry not found"}
    )

@app.delete("/traveler/history")
async def clear_history():
    """Clear all capture history."""
    analysis_history.clear()
    return {"status": "success", "message": "History cleared"}

@app.get("/health")
async def health_check():
    """Simple health check."""
    return {
        "status": "ok",
        "history_size": len(analysis_history),
        "tts_available": HAS_TTS
    }

# ============================================================================
# 6. Server Startup (Kaggle)
# ============================================================================
import threading
import time

print("\n--- KÜLTÜREL YERELLEŞTİRME API v2 ---")
print("Endpoints:")
print("  POST /translate — Text mode")
print("  POST /traveler/analyze — Vision mode (with TTS & history)")
print("  GET /traveler/history — Retrieve capture history")
print("  GET /traveler/history/{entry_id} — Get single entry + audio")
print("  DELETE /traveler/history — Clear all history")
print("  GET /health — Health check")

try:
    print("\nPublic IP:", urllib.request.urlopen('https://ipv4.icanhazip.com').read().decode('utf8').strip("\n"))
except:
    print("Could not fetch public IP")

# Start localtunnel in background
try:
    subprocess.Popen(["npx", "localtunnel", "--port", "8000"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("✅ Localtunnel started on port 8000")
except Exception as e:
    print(f"⚠️  Localtunnel not available: {e}")

# Run API server on separate thread
def run_server():
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()

print("✅ FastAPI Server running on 0.0.0.0:8000")
print("\n--- TTS/Safety Flagging Active ---")
print("Free tier quota: ~1,500 requests/day")
print("If usage grows, consider paid tier.\n")

# Keep the cell alive
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\n⏹️  Server stopped.")
