#!/usr/bin/env bash
# One-command library pipeline: playlist -> local folder -> R2 bucket.
#
# First run:        ./scripts/sync-library.sh <spotify-playlist-url>
# Every run after:  ./scripts/sync-library.sh
# Skip pruning:     ./scripts/sync-library.sh --no-prune  (or with a URL)
#
# spotDL matches each playlist track on YouTube Music and downloads it with
# Spotify metadata embedded; `sync` keeps the folder mirroring the playlist.
# Each run then uploads new tracks and (unless --no-prune) deletes bucket
# objects for tracks you removed from the playlist — full mirror, both ways.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
LIBRARY_DIR="$HOME/Music/mp3-player-library"
SYNC_FILE="$LIBRARY_DIR/sync.spotdl"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Pull an optional --no-prune flag out of the args; the remainder (if any) is
# the playlist URL for a first run.
PRUNE=1
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-prune" ]]; then
    PRUNE=0
  else
    ARGS+=("$arg")
  fi
done

mkdir -p "$LIBRARY_DIR"
cd "$LIBRARY_DIR"

if [[ ${#ARGS[@]} -ge 1 ]]; then
  spotdl sync "${ARGS[0]}" --save-file "$SYNC_FILE" --output "{artist} - {title}.{output-ext}"
elif [[ -f "$SYNC_FILE" ]]; then
  spotdl sync "$SYNC_FILE" --output "{artist} - {title}.{output-ext}"
else
  echo "First run needs a playlist URL: ./scripts/sync-library.sh <spotify-playlist-url>"
  exit 1
fi

cd "$REPO_DIR"
node --env-file=.env scripts/upload-library.mjs "$LIBRARY_DIR"
if [[ "$PRUNE" -eq 1 ]]; then
  node --env-file=.env scripts/prune-library.mjs "$LIBRARY_DIR"
fi
