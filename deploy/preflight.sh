#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${APP_DIR}/.env.production}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f "${ENV_FILE}" ]] || fail "环境文件不存在：${ENV_FILE}"
command -v docker >/dev/null 2>&1 || fail "未安装 docker。"
docker compose version >/dev/null 2>&1 || fail "docker compose 插件不可用。"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${NOVEL_STUDIO_HOST_DATA_DIR:?NOVEL_STUDIO_HOST_DATA_DIR must be set}"
: "${NOVEL_STUDIO_HOST_LIBRARY_ROOT:?NOVEL_STUDIO_HOST_LIBRARY_ROOT must be set}"

[[ "${NOVEL_STUDIO_HOST_DATA_DIR}" = /* ]] || fail "数据目录必须是绝对路径。"
[[ "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" = /* ]] || fail "小说库目录必须是绝对路径。"
[[ "${NOVEL_STUDIO_HOST_DATA_DIR}" != "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" ]] || fail "数据目录与小说库目录不能相同。"

install -d -m 0700 "${NOVEL_STUDIO_HOST_DATA_DIR}"
[[ -d "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" ]] || fail "小说库目录不存在：${NOVEL_STUDIO_HOST_LIBRARY_ROOT}"
[[ ! -L "${NOVEL_STUDIO_HOST_DATA_DIR}" ]] || fail "数据目录不能是符号链接。"
[[ ! -L "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" ]] || fail "小说库目录不能是符号链接。"
[[ -r "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" && -x "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" ]] || fail "小说库目录不可读取。"
[[ -w "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" ]] || fail "小说库目录不可写；正式写回将失败。"
[[ -r "${NOVEL_STUDIO_HOST_DATA_DIR}" && -w "${NOVEL_STUDIO_HOST_DATA_DIR}" && -x "${NOVEL_STUDIO_HOST_DATA_DIR}" ]] || fail "数据目录权限不足。"

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${APP_DIR}/compose.production.yml" \
  config --quiet

printf 'PASS: 生产环境预检通过。\n'
printf 'data=%s\nlibrary=%s\nport=127.0.0.1:%s\n' \
  "${NOVEL_STUDIO_HOST_DATA_DIR}" \
  "${NOVEL_STUDIO_HOST_LIBRARY_ROOT}" \
  "${NOVEL_STUDIO_PUBLIC_PORT:-8790}"
