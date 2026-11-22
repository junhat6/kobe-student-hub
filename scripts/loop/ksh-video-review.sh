#!/bin/sh
# Mac mini の ~/.local/bin/ksh-video-review に置くランチャ。Muse はこれを叩く。
# main の checkout は古いことがあるので、origin/main のスクリプト・指示書・ux-rubric を一時ファイルに書き出して実行する
# （ksh tidy の precheck と同じ形。docs/loop/prompts/video-review.md）。
# 置き方: install -m 755 scripts/loop/ksh-video-review.sh ~/.local/bin/ksh-video-review
set -e
REPO=${KSH_REPO:-$HOME/ghq/github.com/junhat6/kobe-student-hub}
T=$(mktemp -d "${TMPDIR:-/tmp}/ksh-video-review.XXXXXX")
trap 'rm -rf "$T"' EXIT
git -C "$REPO" fetch -q origin main release 2>/dev/null || echo "fetch に失敗。手元の origin/main で続けます" >&2
for f in scripts/loop/video-review.mjs docs/loop/prompts/video-review.md docs/loop/ux-rubric.md; do
  git -C "$REPO" show "origin/main:$f" > "$T/$(basename "$f")"
done
KSH_REPO="$REPO" node "$T/video-review.mjs" --prompt-file "$T/video-review.md" --rubric-file "$T/ux-rubric.md" "$@"
