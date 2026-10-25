"""JSONL TTS worker: bounded Edge requests, cached Piper voices, no OGG encoding."""
import asyncio
import contextlib
import json
import os
from pathlib import Path
import sys
import wave

VOICES = {}
EDGE_TIMEOUT = 2.0


async def edge(text, voice, filename):
    import edge_tts
    # stream() is consumed by save(); one sentence is the bounded audio unit.
    await edge_tts.Communicate(text, voice=voice, connect_timeout=2, receive_timeout=2).save(filename)


def piper(text, model, filename):
    from piper.voice import PiperVoice
    if model not in VOICES:
        VOICES[model] = PiperVoice.load(model)
    with wave.open(filename, "wb") as output:
        VOICES[model].synthesize_wav(text, output)


async def synthesize(text, voice, model, base):
    mp3, wav = base + ".mp3", base + ".wav"
    try:
        await asyncio.wait_for(edge(text, voice, mp3), timeout=EDGE_TIMEOUT)
        if Path(mp3).stat().st_size == 0:
            raise ValueError("empty Edge audio")
        return mp3
    except Exception:
        Path(mp3).unlink(missing_ok=True)
    try:
        piper(text, model, wav)
        if Path(wav).stat().st_size == 0:
            raise ValueError("empty Piper audio")
        return wav
    except Exception:
        Path(wav).unlink(missing_ok=True)
        raise


def reply(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


async def server():
    reply({"id": None, "metin": ""})
    for line in sys.stdin:
        request = json.loads(line)
        try:
            # Library diagnostics must never reach the JSONL channel.
            with contextlib.redirect_stdout(sys.stderr):
                filename = await synthesize(request["metin"], request["ses"], request["model"], request["dosya"])
            reply({"id": request["id"], "metin": filename})
        except Exception:
            reply({"id": request["id"], "hata": "Ses üretilemedi, ses modelini ve kurulumu kontrol edin."})


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUTF8", "1")
    asyncio.run(server())
