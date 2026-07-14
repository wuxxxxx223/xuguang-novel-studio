#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

DATA_DIR="${1:-}"
LIBRARY_ROOT="${2:-}"
BACKUP_ROOT="${3:-}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${NOVEL_STUDIO_OFFLINE_BACKUP_CONFIRMED:-}" == "yes" ]] \
  || fail "为保证一致性，请先停止应用，再设置 NOVEL_STUDIO_OFFLINE_BACKUP_CONFIRMED=yes。"
[[ -n "${DATA_DIR}" && -n "${LIBRARY_ROOT}" && -n "${BACKUP_ROOT}" ]] \
  || fail "用法：NOVEL_STUDIO_OFFLINE_BACKUP_CONFIRMED=yes $0 <data-dir> <library-root> <backup-root>"
[[ -d "${DATA_DIR}" && ! -L "${DATA_DIR}" ]] || fail "数据目录无效或为符号链接。"
[[ -d "${LIBRARY_ROOT}" && ! -L "${LIBRARY_ROOT}" ]] || fail "小说库目录无效或为符号链接。"
[[ ! -e "${DATA_DIR}/.novel-studio.instance.lock" ]] \
  || fail "仍存在实例锁；请确认应用已正常停止后再备份。"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT%/}/novel-studio-${STAMP}"
mkdir -p "${BACKUP_ROOT}"
[[ -d "${BACKUP_ROOT}" && ! -L "${BACKUP_ROOT}" ]] || fail "备份根目录无效或为符号链接。"
[[ ! -e "${DEST}" ]] || fail "同名备份已存在，请稍后重试：${DEST}"
STAGING="$(mktemp -d "${BACKUP_ROOT%/}/.novel-studio-${STAMP}.XXXXXX")"
cleanup() {
  rm -rf -- "${STAGING}"
}
trap cleanup EXIT

tar --format=posix --numeric-owner -C "${DATA_DIR}" -czf "${STAGING}/data.tar.gz" .
tar --format=posix --numeric-owner -C "${LIBRARY_ROOT}" -czf "${STAGING}/library.tar.gz" .
(
  cd "${STAGING}"
  sha256sum data.tar.gz library.tar.gz > SHA256SUMS
  {
    printf 'created_at_utc=%s\n' "${STAMP}"
    printf 'hostname=%s\n' "$(hostname)"
    printf 'data_source=%s\n' "$(realpath "${DATA_DIR}")"
    printf 'library_source=%s\n' "$(realpath "${LIBRARY_ROOT}")"
  } > backup.meta
)
chmod 0600 "${STAGING}/data.tar.gz" "${STAGING}/library.tar.gz" "${STAGING}/SHA256SUMS" "${STAGING}/backup.meta"
mv -- "${STAGING}" "${DEST}"
trap - EXIT

printf '备份完成：%s\n' "${DEST}"
printf '警告：data.tar.gz 可能包含模型 API Key，离机复制前必须加密并限制访问权限。\n'
