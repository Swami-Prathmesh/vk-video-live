"""
Free, unlimited, self-hosted translation for VK Video Live.

Runs Meta's NLLB-200 (distilled 600M, ~1.2 GB) locally with no API key, no
quota and no per-character cost. Exposes the two endpoints the Cloudflare
Worker and the browser already speak:

    POST /translate        {"text": "...", "source": "ru", "target": "hi"}
    POST /translate-batch  {"texts": ["...", "..."], "source": "ru", "target": "hi"}

Run it:

    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8080

Then set the worker secret MT_BASE=http://<your-host>:8080 and every
translation is served by your own machine — free and unlimited.

CPU-only is fine for the 600M model (~0.5–2 s per short sentence); a GPU is
roughly 10–20x faster. For Indic-heavy traffic you can swap the model for
AI4Bharat's IndicTrans2 by changing MODEL and the language map below.
"""

import os
from typing import List

import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL = os.environ.get("MT_MODEL", "facebook/nllb-200-distilled-600M")
MAX_INPUT = int(os.environ.get("MT_MAX_INPUT", "512"))

# short code -> NLLB language tag
NLLB = {
    "en": "eng_Latn",
    "hi": "hin_Deva",
    "mr": "mar_Deva",
    "gu": "guj_Gujr",
    "bn": "ben_Beng",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "kn": "kan_Knda",
    "ml": "mal_Mlym",
    "pa": "pan_Guru",
    "or": "ory_Orya",
    "as": "asm_Beng",
    "ur": "urd_Arab",
    "ru": "rus_Cyrl",
}

app = FastAPI(title="vk-video-live mt", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_tokenizer = None
_model = None


def load():
    global _tokenizer, _model
    if _model is None:
        print(f"loading {MODEL} …")
        _tokenizer = AutoTokenizer.from_pretrained(MODEL)
        _model = AutoModelForSeq2SeqLM.from_pretrained(
            MODEL, torch_dtype=torch.float32
        )
        _model.eval()
    return _tokenizer, _model


class One(BaseModel):
    text: str
    source: str = "ru"
    target: str = "hi"


class Many(BaseModel):
    texts: List[str]
    source: str = "ru"
    target: str = "hi"


def translate_batch(texts: List[str], source: str, target: str) -> List[str]:
    if not texts:
        return []
    src = NLLB.get(source, "rus_Cyrl")
    tgt = NLLB.get(target, "eng_Latn")
    if src == tgt:
        return list(texts)

    tok, model = load()
    tok.src_lang = src
    out: List[str] = []
    for chunk_start in range(0, len(texts), 16):
        chunk = [t[:MAX_INPUT] for t in texts[chunk_start:chunk_start + 16]]
        enc = tok(chunk, return_tensors="pt", padding=True, truncation=True)
        forced = tok.convert_tokens_to_ids(tgt)
        with torch.no_grad():
            generated = model.generate(
                **enc,
                forced_bos_token_id=forced,
                max_new_tokens=256,
                num_beams=2,
            )
        out.extend(tok.batch_decode(generated, skip_special_tokens=True))
    return out


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "loaded": _model is not None}


@app.post("/translate")
def translate(body: One):
    return {"text": translate_batch([body.text], body.source, body.target)[0]}


@app.post("/translate-batch")
def translate_many(body: Many):
    return {"texts": translate_batch(body.texts, body.source, body.target)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
