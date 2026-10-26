#!/bin/sh
# Ubuntu source checkout bootstrap. Downloaded bytes are checked against a pinned
# official Node release digest before extraction or execution.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo 'YAPLIX: требуется Ubuntu 24.04 x64.' >&2; exit 1
fi
if ! grep -q '^ID=ubuntu$' /etc/os-release || ! grep -q '^VERSION_ID="24.04"$' /etc/os-release; then
  echo 'YAPLIX: требуется Ubuntu 24.04 x64.' >&2; exit 1
fi
name=node-v24.18.0-linux-x64
expected=55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742
base=${YAPLIX_BOOTSTRAP_HOME:-${XDG_DATA_HOME:-"$HOME/.local/share"}/yaplix/tools}
mkdir -p -- "$base"
node="$base/$name/bin/node"
valid_node() { [ -x "$1" ] && [ "$("$1" --version 2>/dev/null || :)" = v24.18.0 ]; }

# An explicit offline archive is always verified, including when a suitable
# system Node is present. This supports air-gapped installations and testing.
if [ -n "${YAPLIX_BOOTSTRAP_ARCHIVE:-}" ] || ! valid_node "$node"; then
  if ! command -v sha256sum >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    echo 'YAPLIX: нужны стандартные sha256sum и tar.' >&2; exit 1
  fi
  stage=$(mktemp -d "$base/.node-stage.XXXXXXXX")
  cleanup() { rm -rf -- "$stage"; }
  trap cleanup EXIT HUP INT TERM
  archive="$stage/$name.tar.xz"
  if [ -n "${YAPLIX_BOOTSTRAP_ARCHIVE:-}" ]; then
    cp -- "$YAPLIX_BOOTSTRAP_ARCHIVE" "$archive"
  else
    if ! command -v curl >/dev/null 2>&1; then
      echo 'YAPLIX: нужен curl для загрузки Node; можно передать проверенный архив через YAPLIX_BOOTSTRAP_ARCHIVE.' >&2; exit 1
    fi
    echo 'YAPLIX: загружаем изолированный Node 24.18.0 с nodejs.org.' >&2
    curl --fail --location --silent --show-error --connect-timeout 15 --max-time 180 --retry 2 \
      --output "$archive" "https://nodejs.org/dist/v24.18.0/$name.tar.xz"
  fi
  actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
  if [ "$actual" != "$expected" ]; then
    echo 'YAPLIX: SHA256 архива Node не совпал; ничего не выполнялось.' >&2; exit 1
  fi
  tar -xJf "$archive" -C "$stage"
  if ! valid_node "$stage/$name/bin/node"; then
    echo 'YAPLIX: проверенный архив не содержит подходящий Node.' >&2; exit 1
  fi
  if [ ! -e "$base/$name" ]; then mv -- "$stage/$name" "$base/$name"; fi
  node="$base/$name/bin/node"
  if ! valid_node "$node"; then
    echo 'YAPLIX: существующий изолированный Node повреждён; каталог сохранён.' >&2; exit 1
  fi
  trap - EXIT HUP INT TERM
  cleanup
fi
if [ "${1:-}" = --runtime-only ]; then printf '%s\n' "$node"; exit 0; fi
exec "$node" "$root/scripts/install-source.mjs" "$@"
