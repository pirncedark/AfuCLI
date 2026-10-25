"""Türkçe konuşmayı yalnız önceden indirilmiş small modeliyle yazıya döker."""

import argparse
import os
from pathlib import Path
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dosya", nargs="?")
    parser.add_argument("--model-dir", default=os.environ.get("AFU_WHISPER_DIR") or r"F:\afu_buyuk\whisper")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        from faster_whisper import WhisperModel
        from faster_whisper.utils import download_model
    except ImportError:
        print("Konuşma bileşeni eksik, faster-whisper kurulumunu tamamlayın.", file=sys.stderr)
        return 1

    try:
        # local_files_only ensures this probe neither downloads nor writes models.
        cached = Path(download_model("small", cache_dir=args.model_dir, local_files_only=True))
        required = ("model.bin", "config.json", "tokenizer.json")
        if not all((cached / name).is_file() and (cached / name).stat().st_size > 0 for name in required):
            raise FileNotFoundError()
        if not any(cached.glob("vocabulary.*")):
            raise FileNotFoundError()
    except Exception:
        print("Konuşma modeli eksik, small modelinin indirilmesini bekleyin.", file=sys.stderr)
        return 3

    if args.check:
        return 0
    if not args.dosya or not Path(args.dosya).is_file():
        print("Ses dosyası okunamadı, geçerli bir dosya seçin.", file=sys.stderr)
        return 1

    try:
        # Passing the resolved snapshot avoids tokenizer downloads as well.
        model = WhisperModel(str(cached), device="cpu", compute_type="int8",
                             download_root=args.model_dir, local_files_only=True)
        segments, _ = model.transcribe(args.dosya, language="tr")
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            print("Konuşma algılanamadı, daha anlaşılır bir ses kaydı seçin.", file=sys.stderr)
            return 1
        print(text)
        return 0
    except Exception:
        print("Ses yazıya dökülemedi, ses dosyasını ve Whisper kurulumunu kontrol edin.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
