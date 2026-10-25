"""Kalıcı veya tek seferlik, çevrimdışı Türkçe Whisper transkripsiyonu."""

import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

# Match whole boilerplate sentences, never arbitrary substrings of real speech.
_BOILERPLATE = re.compile(
    r"(?:(?:lutfen )?(?:"
    r"(?:(?:kanalima|kanalimiza|kanala) )?abone (?:ol|olun|olmayi unutmayin)"
    r"|(?:(?:videoyu|videomu|videomuzu) )?begen(?:in|meyi unutmayin)?"
    r"|izlediginiz icin tesekkur(?:ler| ederim| ederiz)?"
    r"|altyazi(?: m k)?|m k"
    r"|yorum yapmayi unutmayin"
    r")(?: ve | )?)+"
)


def halusinasyon_suz(text: str) -> str:
    """Remove only sentences consisting entirely of known Whisper boilerplate."""
    # Protect initials so sentence splitting does not leave a stray K behind.
    protected = re.sub(r"\bM\s*\.\s*K\s*\.", "M\u2060K", text, flags=re.IGNORECASE)
    kept = []
    for sentence in re.split(r"(?<=[.!?])\s*|[\r\n]+", protected):
        sentence = sentence.replace("M\u2060K", "M.K.").strip()
        if not sentence:
            continue
        normalized = sentence.translate(str.maketrans("İIıŞşĞğÜüÖöÇç", "iiiSsGgUuOoCc")).lower()
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized).strip()
        if normalized and not _BOILERPLATE.fullmatch(normalized):
            kept.append(sentence)
    return " ".join(kept)


def yaziya_dok(model, audio) -> str:
    segments, _ = model.transcribe(
        audio, language="tr", beam_size=1, vad_filter=True,
        condition_on_previous_text=False, no_speech_threshold=0.6,
    )
    return halusinasyon_suz(" ".join(
        segment.text.strip() for segment in segments if segment.no_speech_prob <= 0.6
    ))


class Whisper:
    def __init__(self, model_dir: str):
        self.model_dir = model_dir
        self.cuda = False
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() < 1:
                raise RuntimeError("CUDA kullanılamıyor")
            self.model = self.load(os.environ.get("AFU_WHISPER_MODEL") or "large-v3-turbo", "cuda", "float16")
            self.warm()
            self.cuda = True
        except Exception as error:
            print(f"Whisper CPU yedeğine geçiyor: {error}", file=sys.stderr)
            self.cpu()

    def load(self, name, device, compute_type):
        from faster_whisper import WhisperModel
        return WhisperModel(name, device=device, compute_type=compute_type,
                            download_root=self.model_dir, local_files_only=True)

    def warm(self):
        import numpy as np
        # Disable VAD here to actually exercise the encoder/decoder on 0.5 s silence.
        segments, _ = self.model.transcribe(
            np.zeros(8000, dtype=np.float32), language="tr", beam_size=1,
            vad_filter=False, condition_on_previous_text=False, no_speech_threshold=0.6,
        )
        list(segments)

    def cpu(self):
        self.cuda = False
        self.model = None  # Release the CUDA model before allocating the fallback.
        self.model = self.load("small", "cpu", "int8")
        self.warm()

    def transcribe(self, audio):
        try:
            return yaziya_dok(self.model, audio)
        except Exception:
            if not self.cuda:
                raise
            self.cpu()
            return yaziya_dok(self.model, audio)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def serve(whisper):
    # Readiness is emitted only after model loading and warmup complete.
    emit({"id": None, "metin": ""})
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            audio = request["dosya"]
            if not isinstance(audio, str) or not Path(audio).is_file():
                raise ValueError("Ses dosyası okunamadı, geçerli bir dosya seçin.")
            with contextlib.redirect_stdout(sys.stderr):
                text = whisper.transcribe(audio)
            emit({"id": request_id, "metin": text})
        except Exception:
            emit({"id": request_id, "hata": "Ses yazıya dökülemedi, ses dosyasını ve Whisper kurulumunu kontrol edin."})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dosya", nargs="?")
    parser.add_argument("--model-dir", default=os.environ.get("AFU_WHISPER_DIR") or r"F:\afu_buyuk\whisper")
    parser.add_argument("--sunucu", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.sunucu and not args.check and (not args.dosya or not Path(args.dosya).is_file()):
        print("Ses dosyası okunamadı, geçerli bir dosya seçin.", file=sys.stderr)
        return 1
    try:
        with contextlib.redirect_stdout(sys.stderr):
            whisper = Whisper(args.model_dir)
        if args.check:
            return 0
        if args.sunucu:
            return serve(whisper)
        with contextlib.redirect_stdout(sys.stderr):
            text = whisper.transcribe(args.dosya)
        print(text)
        return 0
    except Exception:
        print("Ses yazıya dökülemedi, Whisper kurulumunu ve indirilen modelleri kontrol edin.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
