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
expected_binary=41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c
base=${YAPLIX_BOOTSTRAP_HOME:-${XDG_DATA_HOME:-"$HOME/.local/share"}/yaplix/tools}
node="$base/$name/bin/node"
valid_node() { [ -x "$1" ] && [ "$(sha256sum "$1" | cut -d ' ' -f 1)" = "$expected_binary" ]; }
if ! command -v sha256sum >/dev/null 2>&1; then echo 'YAPLIX: нужен sha256sum.' >&2; exit 1; fi
echo 'YAPLIX: план — проверить Node 24.18.0, при необходимости загрузить официальный архив с SHA256 в личный профиль; затем временно собрать исходники через npm ci и открыть мастер установки. Системные пакеты не меняются; база сохраняется с backup при обновлении.' >&2
echo 'YAPLIX: сеть нужна только для недостающих Node/npm-компонентов; существующие HTTP_PROXY, HTTPS_PROXY и NO_PROXY сохраняются.' >&2
mkdir -p -- "$base"

# An explicit offline archive is always verified, including when a suitable
# system Node is present. This supports air-gapped installations and testing.
if [ -n "${YAPLIX_BOOTSTRAP_ARCHIVE:-}" ] || ! valid_node "$node"; then
  if ! command -v tar >/dev/null 2>&1; then
    echo 'YAPLIX: нужен стандартный tar.' >&2; exit 1
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
    if ! curl --fail --location --silent --show-error --connect-timeout 15 --max-time 180 --retry 2 \
      --output "$archive" "https://nodejs.org/dist/v24.18.0/$name.tar.xz"; then
      echo 'YAPLIX: загрузка Node не удалась. Проверьте DNS/TLS/маршрут и переменные HTTP_PROXY, HTTPS_PROXY, NO_PROXY; повторите команду или укажите YAPLIX_BOOTSTRAP_ARCHIVE.' >&2
      exit 1
    fi
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
    echo 'YAPLIX: существующий изолированный Node не совпадает с официальным SHA256; каталог сохранён.' >&2; exit 1
  fi
  trap - EXIT HUP INT TERM
  cleanup
fi
if [ "${1:-}" = --runtime-only ]; then printf '%s\n' "$node"; exit 0; fi
exec "$node" "$root/scripts/install-source.mjs" "$@"
