import os
import gc
import torch
import nest_asyncio
import uvicorn
import subprocess
import urllib.request
import base64
from langchain_core.messages import HumanMessage
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from huggingface_hub import login
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser
from kaggle_secrets import UserSecretsClient
from langchain_google_genai import ChatGoogleGenerativeAI
user_secrets = UserSecretsClient()
gemini_api_key = user_secrets.get_secret("GEMINI_API_KEY")

# 1. API UYGULAMASINI BAŞLAT
app = FastAPI(title="Kültürel Yerelleştirme API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Herkese açık (Geliştirme aşaması için '*')
    allow_credentials=True,
    allow_methods=["*"],  # GET, POST, OPTIONS vb. her şeye izin ver
    allow_headers=["*"],
)

# İstemciden (Cursor/React) Gelecek Veri Formatı
class TranslateRequest(BaseModel):
    text: str
    target_language: str
    persona: str

# 2. MODEL VE ZİNCİR KURULUMLARI (Sadece sunucu başlarken 1 kez çalışır)
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=gemini_api_key)

# --- LANGCHAIN AŞAMA 1 ---
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

#2.5 TRAVELER PROMPT
traveler_llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.3, google_api_key=gemini_api_key)

def build_traveler_direct_translation_prompt(target_language: str, mode: str) -> str:
    """
    FAST ENDPOINT PROMPT: Used for the initial split-second translation.
    Hints are modified to help with translation accuracy ONLY, no explanations.
    """
    mode_hints = {
        "menu": "Context: Restaurant menu. Translate culinary terms and ingredients accurately.",
        "sign": "Context: Public sign or notice. Translate concisely, maintaining the authoritative tone.",
        "product": "Context: Product label. Translate the item name and key details directly.",
        "object": "Context: General object or scene."
    }
    hint = mode_hints.get(mode, mode_hints["object"])
    
    return f"""You are a hyper-efficient direct translation agent helping a traveler in a foreign country.
Your ONLY job is to extract the text visible in the image and translate it directly into {target_language}.

{hint}

CRITICAL RULES:
1. OUTPUT ONLY THE TRANSLATION. Do not add introductory phrases like "The text says...", "Here is the translation:", or "This is a sign for...".
2. DO NOT EXPLAIN the object, the background, or the cultural context. Just translate the words.
3. Keep the language simple, direct, and free of jargon so a traveler can understand it instantly in a split second.
4. If there is absolutely NO readable text in the image, output exactly this phrase: "NO_TEXT_FOUND".

Translate the text in the image to {target_language} now.
"""
    
def build_traveler_prompt(target_language: str, mode: str) -> str:
    """
    DETAILED ENDPOINT PROMPT: Used when the user clicks "Discover Context" or wants a chat.
    Hints here actively encourage explanation and flagging safety issues.
    """
    mode_hints = {
        "menu": "This is likely a restaurant menu. Mention any allergens or unusual ingredients you notice.",
        "sign": "This is likely a sign or notice. Flag if it's a warning, rule, or safety instruction.",
        "product": "This is likely a product label. Mention price, quantity, or usage instructions if visible.",
        "object": "This is a general object or scene the traveler is curious about."
    }
    hint = mode_hints.get(mode, mode_hints["object"])
    
    return f"""You are a patient local friend helping a traveler who doesn't speak the language.
Look at the image. {hint}
Explain what it is and what it means in {target_language}, in simple, warm, non-technical language.
If there's text in the image, tell them what it says AND what it means practically for them.
Do not use jargon. Keep it short — 2-4 sentences.
If anything looks like a warning or safety issue, say so clearly at the start."""
    
# 3. ENDPOINT OLUŞTURMA (Cursor buradan istek atacak)
@app.post("/translate")
async def process_translation(req: TranslateRequest):
    try:
        # 1. Aşama: Orijinal metni JSON'a çevir
        data = json_chain.invoke({"text": req.text})
        
        # 2. Aşama: Yeni persona ve dilde sentezle
        render_conclusion = render_chain.invoke({
            "target_language": req.target_language,
            "persona": req.persona,
            **data
        })
        
        # Cursor'a düzenli bir JSON paketi gönder
        return {
            "status": "success",
            "original_text": req.text,
            "extracted_data": data,
            "final_translation": render_conclusion
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/traveler/translation")
async def traveler_translation(
    image: UploadFile = File(...),
    target_language: str = Form(...),
    mode: str = Form("object")
):
    try:
        image_bytes = await image.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = image.content_type or "image/jpeg"

        prompt_text = build_traveler_direct_translation_prompt(target_language, mode)

        # DOĞRU OLAN KISIM (Süslü parantez ve 'url' eklendi)
        message = HumanMessage(content=[
            {"type": "text", "text": prompt_text},
            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_b64}"}}
        ])

        response = traveler_llm.invoke([message])

        return {
            "status": "success",
            "mode": mode,
            "target_language": target_language,
            "translation": response.content
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
        
@app.post("/traveler/analyze")
async def traveler_analyze(
    image: UploadFile = File(...),
    target_language: str = Form(...),
    mode: str = Form("object")
):
    try:
        image_bytes = await image.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = image.content_type or "image/jpeg"

        prompt_text = build_traveler_prompt(target_language, mode)

        message = HumanMessage(content=[
            {"type": "text", "text": prompt_text},
            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_b64}"}}
        ])

        response = traveler_llm.invoke([message])

        return {
            "status": "success",
            "mode": mode,
            "target_language": target_language,
            "explanation": response.content
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Backend is running!"}

@app.get("/test-traveler")
async def test_traveler():
    return {
        "status": "ok", 
        "message": "Traveler endpoint is available",
        "endpoints": ["/translate", "/traveler/analyze", "/health"]
    }
# 4. KAGGLE ÜZERİNDE SUNUCUYU DIŞA AÇMA VE ÇALIŞTIRMA
import threading
import subprocess
import urllib.request
import time

print("\n--- CURSOR İÇİN BAĞLANTI BİLGİLERİ ---")
print("Şifreniz (Endpoint IP):", urllib.request.urlopen('https://ipv4.icanhazip.com').read().decode('utf8').strip("\n"))

# Localtunnel'ı arka planda başlat
subprocess.Popen(["npx", "localtunnel", "--port", "8000"])

# API Sunucusunu Kaggle'ı çökertmemesi için ayrı bir Thread'de başlatıyoruz
def run_server():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()

print("✅ FastAPI Sunucusu arka planda başarıyla çalışıyor!")

# Hücrenin kapanmasını engellemek için sonsuz bir döngü
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("Sunucu durduruldu.")