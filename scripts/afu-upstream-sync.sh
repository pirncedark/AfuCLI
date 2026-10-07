#!/bin/bash
set -euo pipefail

# Kullanım: bash scripts/afu-upstream-sync.sh [--dry-run] [--no-push]
# Upstream'den güncellemeleri (merge-tree ile test edip) afu-cli'ye almak.

DRY_RUN=false
NO_PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --no-push)
      NO_PUSH=true
      shift
      ;;
    *)
      echo "Hata: Bilinmeyen seçenek: $1"
      exit 1
      ;;
  esac
done

# Ön koşullar
if [ -n "$(git status --short)" ]; then
  echo "Hata: Çalışma ağacı temiz değil. Önce değişikliklerini commit'le."
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "afu-cli" ]; then
  echo "Hata: Dal afu-cli değil (şu anki: $CURRENT_BRANCH)."
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo "Hata: gh (GitHub CLI) yok."
  exit 1
fi

if ! command -v bun &> /dev/null; then
  echo "Hata: bun yok."
  exit 1
fi

# upstream remote ekle
git remote add upstream https://github.com/can1357/oh-my-pi.git 2>/dev/null || true
git fetch upstream main

# Geride sayısını hesapla
BEHIND=$(git rev-list --count HEAD..upstream/main)

if [ "$BEHIND" -eq 0 ]; then
  echo "Güncel."
  exit 0
fi

echo "Geride: $BEHIND commit."

# Dry-run modu: merge-tree ve workflow kontrolü
if [ "$DRY_RUN" = true ]; then
  echo "— Dry-run modu —"
  
  MERGE_CODE=0
  TREE_OUT=$(git merge-tree --write-tree --name-only HEAD upstream/main 2>&1) || MERGE_CODE=$?

  if [ "$MERGE_CODE" -eq 0 ]; then
    echo "✓ Temiz birleştirme."
  else
    # İlk satır tree OID'si; boş satıra kadar çakışan dosyalar, sonrası bilgi mesajları.
    CONFLICTS=$(printf '%s
' "$TREE_OUT" | sed -n '2,/^$/p' | sed '/^$/d' | head -30 | tr '
' ',' | sed 's/,$//')
    echo "✗ Çakışma: ${CONFLICTS:-ayrıntı alınamadı}"
  fi

  WF_CHANGES=$(git diff --name-only HEAD...upstream/main -- .github/workflows 2>/dev/null | wc -l)
  if [ "$WF_CHANGES" -gt 0 ]; then
    echo "⚠️ Workflow değişikliği var."
  else
    echo "✓ Workflow değişikliği yok."
  fi
  
  exit 0
fi

# Gerçek merge: yeni dal oluştur
BRANCH="upstream-sync/$(date +%Y-%m-%d)"
if git rev-parse --verify "$BRANCH" &>/dev/null; then
  echo "Hata: Dal zaten var ($BRANCH). Sil ve tekrar çalıştır."
  exit 1
fi

git switch -c "$BRANCH"

# Merge
if ! git merge --no-edit upstream/main; then
  echo "Hata: Çakışma var; birleştirme geri alındı. Çakışan dosyalar:"
  git diff --name-only --diff-filter=U | head -30
  git merge --abort
  git switch afu-cli
  git branch -D "$BRANCH"
  exit 2
fi

# Testler
echo "— Testler çalışıyor —"

if ! bun install --frozen-lockfile; then
  echo "Hata: bun install başarısız."
  git switch afu-cli
  git branch -D "$BRANCH"
  exit 3
fi

TEST_FAILED=false

if ! (cd packages/tui && bun test test/windows-input-mode.test.ts test/terminal-win32-key-buffer.test.ts); then
  echo "✗ TUI testleri başarısız."
  TEST_FAILED=true
fi

if ! (cd packages/coding-agent && bun test test/update-cli.test.ts test/cli/afu-release.test.ts); then
  echo "✗ coding-agent testleri başarısız."
  TEST_FAILED=true
fi

if [ "$TEST_FAILED" = true ]; then
  echo "Hata: Testler başarısız. Birleştirme dalı silindi, afu-cli dalına dönüldü."
  git switch afu-cli
  git branch -D "$BRANCH"
  exit 3
fi

echo "✓ Testler geçti."

# Sürüm uyarısı (değiştirme)
FORK_VER=$(grep -m1 '"version"' packages/coding-agent/package.json | sed 's/.*: *"\([^"]*\)".*//')
UPSTREAM_VER=$(git show upstream/main:packages/coding-agent/package.json | grep -m1 '"version"' | sed 's/.*: *"\([^"]*\)".*//')
if [ "$FORK_VER" != "$UPSTREAM_VER" ]; then
  echo "⚠️ Sürüm farkı: fork=$FORK_VER, upstream=$UPSTREAM_VER (değiştirilmedi)."
fi

# Push ve PR
if [ "$NO_PUSH" = false ]; then
  git push -u origin "$BRANCH"
  
  BODY="Upstream'den $BEHIND commit. Testler geçti:
  
- TUI testleri
- coding-agent testleri

**Not**: Merge etmeden önce Actions'ta afu-release derlemesini beklemeyin; sürüm çıkarmak ayrı adım."
  
  if gh pr create --base afu-cli --title "Upstream sync $(date +%Y-%m-%d)" --body "$BODY"; then
    echo "✓ Birleştirildi ve PR açıldı. Merge etmeden önce PR'ı incele."
  else
    echo "Hata: Dal pushlandı ama PR açılamadı; GitHub'da elle aç: $BRANCH"
    exit 4
  fi
else
  echo "✓ Birleştirildi (push atlandı)."
fi
