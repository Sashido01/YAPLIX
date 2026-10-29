#!/bin/sh
# YAPLIX: автономный запуск на Linux.
# Не требует установленного Node.js/npm в PATH: находит подходящий системный
# node 24.18+ (24.x), иначе использует локальный рантайм .local/yaplix-runtime,
# иначе скачивает его с официального nodejs.org с проверкой SHA-256
# (см. scripts/node-bootstrap.mjs). Системный /usr/bin/node не заменяется,
# sudo и nvm не нужны.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
NODE_MIN_MAJOR=24
NODE_MIN_MINOR=18
RUNTIME_BASE="$ROOT/.local/yaplix-runtime"
log() { printf '%s\n' "$*"; }
has_version() {
  # has_version <bin>: возвращает 0, если <bin> --version даёт v24.18+ ветки 24.x.
  bin="$1"
  [ -x "$bin" ] || return 1
  ver=$("$bin" --version 2>/dev/null || true)
  v=${ver#v}
  major=${v%%.*}
  rest=${v#*.}
  minor=${rest%%.*}
  case "$major.$minor" in
    *[!0-9]*.*|*.*[!0-9]*) return 1 ;;
  esac
  if [ "$major" -eq 24 ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; then
    printf '%s' "$ver"
    return 0
  fi
  return 1
}
pick_node() {
  # 1. Подходящий системный node из PATH.
  if command -v node >/dev/null 2>&1; then
    if ver=$(has_version "$(command -v node)"); then printf '%s|%s' "$(command -v node)" "$ver"; return 0; fi
  fi
  # 2. Уже установленный локальный рантайм (без сети): сначала маркер current.
  if [ -d "$RUNTIME_BASE" ]; then
    cur=""
    if [ -f "$RUNTIME_BASE/current" ]; then cur=$(cat "$RUNTIME_BASE/current" 2>/dev/null || true); fi
    cands="$cur"
    # shellcheck disable=SC2012
    cands="$cands $(ls -r "$RUNTIME_BASE" 2>/dev/null || true)"
    for d in $cands; do
      case "$d" in .*|current|SHASUMS*) continue ;; esac
      bin="$RUNTIME_BASE/$d/bin/node"
      if ver=$(has_version "$bin" 2>/dev/null); then printf '%s|%s' "$bin" "$ver"; return 0; fi
    done
  fi
  return 1
}
NODE_BIN=""
NODE_VER=""
if picked=$(pick_node); then
  NODE_BIN=${picked%%|*}
  NODE_VER=${picked#*|}
else
  # 3. Подходящего node нет: скачиваем локальный рантайм любым доступным интерпретатором.
  HELPER=""
  for c in node nodejs; do
    if command -v "$c" >/dev/null 2>&1; then HELPER=$(command -v "$c"); break; fi
  done
  if [ -z "$HELPER" ]; then
    log "ОШИБКА: не найден Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ (ветка ${NODE_MIN_MAJOR}.x) и нет интерпретатора для автоустановки."
    log "Установите Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ с https://nodejs.org (Linux, ветка ${NODE_MIN_MAJOR}.x) и повторите: ./yaplix.sh"
    exit 1
  fi
  log "Подходящий Node.js не найден. Скачиваю локальный Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ только для YAPLIX (систему не трогаю)..."
  if ! "$HELPER" "$ROOT/scripts/node-bootstrap.mjs"; then
    log "ОШИБКА: не удалось подготовить локальный Node.js. Проверьте подключение к https://nodejs.org и повторите: ./yaplix.sh"
    exit 1
  fi
  if picked=$(pick_node); then
    NODE_BIN=${picked%%|*}
    NODE_VER=${picked#*|}
  else
    log "ОШИБКА: локальный Node.js не прошёл проверку версии. Повторите: ./yaplix.sh"
    exit 1
  fi
fi
log "Использую Node.js $NODE_VER ($NODE_BIN). Системный /usr/bin/node не изменяю."
# npm строго от выбранного node: npm-cli.js рядом с ним. PATH используется
# только если выбран системный node из PATH (тогда npm оттуда же). Перемешивание
# системного npm с локальным node запрещено: иначе запуск уходил на Node 22.
NPM_CLI=""
NODE_HOME=$(dirname -- "$(dirname -- "$NODE_BIN")")
if [ -f "$NODE_HOME/lib/node_modules/npm/bin/npm-cli.js" ]; then
  NPM_CLI="$NODE_HOME/lib/node_modules/npm/bin/npm-cli.js"
fi
case "$NODE_BIN" in
  "$RUNTIME_BASE"/*) ;;
  *) if [ -z "$NPM_CLI" ] && command -v npm >/dev/null 2>&1; then NPM_CLI="$(command -v npm)"; fi ;;
esac
if [ -z "$NPM_CLI" ]; then
  log "ОШИБКА: не найден npm для Node.js $NODE_VER. Повторите запуск: ./yaplix.sh"
  exit 1
fi
exec "$NODE_BIN" "$NPM_CLI" run app -- "$@"
