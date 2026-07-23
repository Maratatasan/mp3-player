#!/usr/bin/env bash
# One-command library pipeline: playlist -> local folder -> R2 bucket.
#
# First run:        ./scripts/sync-library.sh <spotify-playlist-url>
# Every run after:  ./scripts/sync-library.sh
#
# spotDL matches each playlist track on YouTube Music and downloads it with
# Spotify metadata embedded; `sync` keeps the folder mirroring the playlist.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
LIBRARY_DIR="$HOME/Music/mp3-player-library"
SYNC_FILE="$LIBRARY_DIR/sync.spotdl"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$LIBRARY_DIR"
cd "$LIBRARY_DIR"

if [[ $# -ge 1 ]]; then
  spotdl sync "$1" --save-file "$SYNC_FILE" --output "{artist} - {title}.{output-ext}"
elif [[ -f "$SYNC_FILE" ]]; then
  spotdl sync "$SYNC_FILE" --output "{artist} - {title}.{output-ext}"
else
  echo "First run needs a playlist URL: ./scripts/sync-library.sh <spotify-playlist-url>"
  exit 1
fi

cd "$REPO_DIR"
node --env-file=.env scripts/upload-library.mjs "$LIBRARY_DIR"
