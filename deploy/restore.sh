#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_DIR="${1:-}"
DATA_TARGET="${2:-}"
LIBRARY_TARGET="${3:-}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${NOVEL_STUDIO_OFFLINE_RESTORE_CONFIRMED:-}" == "yes" ]] \
  || fail "请先停止应用，再设置 NOVEL_STUDIO_OFFLINE_RESTORE_CONFIRMED=yes。"
[[ -n "${BACKUP_DIR}" && -n "${DATA_TARGET}" && -n "${LIBRARY_TARGET}" ]] \
  || fail "用法：NOVEL_STUDIO_OFFLINE_RESTORE_CONFIRMED=yes $0 <backup-dir> <empty-data-target> <empty-library-target>"
[[ "${BACKUP_DIR}" = /* && "${DATA_TARGET}" = /* && "${LIBRARY_TARGET}" = /* ]] \
  || fail "备份目录与恢复目标必须使用绝对路径。"
[[ -f "${BACKUP_DIR}/SHA256SUMS" && -f "${BACKUP_DIR}/data.tar.gz" && -f "${BACKUP_DIR}/library.tar.gz" ]] \
  || fail "备份集不完整。"

DATA_TARGET_ABS="$(realpath -m "${DATA_TARGET}")"
LIBRARY_TARGET_ABS="$(realpath -m "${LIBRARY_TARGET}")"
case "${DATA_TARGET_ABS}/" in
  "${LIBRARY_TARGET_ABS}/"*) fail "数据恢复目标不能位于小说库恢复目标内。" ;;
esac
case "${LIBRARY_TARGET_ABS}/" in
  "${DATA_TARGET_ABS}/"*) fail "小说库恢复目标不能位于数据恢复目标内。" ;;
esac

(
  cd "${BACKUP_DIR}"
  sha256sum --check SHA256SUMS
)

for archive in "${BACKUP_DIR}/data.tar.gz" "${BACKUP_DIR}/library.tar.gz"; do
  if tar -tzf "${archive}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail "归档包含不安全路径：${archive}"
  fi
done

for target in "${DATA_TARGET}" "${LIBRARY_TARGET}"; do
  [[ ! -L "${target}" ]] || fail "恢复目标不能是符号链接：${target}"
  mkdir -p "${target}"
  [[ -z "$(find "${target}" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "恢复目标必须为空：${target}"
done

tar --no-same-owner -C "${DATA_TARGET}" -xzf "${BACKUP_DIR}/data.tar.gz"
tar --no-same-owner -C "${LIBRARY_TARGET}" -xzf "${BACKUP_DIR}/library.tar.gz"
chmod 0700 "${DATA_TARGET}"

find "${DATA_TARGET}" -type f -name '*.json' -print0 | while IFS= read -r -d '' file; do
  node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${file}" \
    || fail "JSON 校验失败：${file}"
done

printf '恢复完成。不要直接覆盖原目录；先用新挂载执行 readiness 与 smoke，再切换。\n'
