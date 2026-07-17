function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasContractValue(value) {
  return (isPlainObject(value) && Object.keys(value).length > 0)
    || (typeof value === 'string' && value.trim().length > 0);
}

function parseObject(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function looksLikeChapterContract(value) {
  if (!isPlainObject(value)) return false;
  return [
    'chapterId', 'chapterNumber', 'candidateTitle', 'title', 'chapterGoal', 'goal',
    'coreConflict', 'chapterEndHook', 'endHook', 'hook', 'requiredBeats', 'mustInclude',
  ].some((key) => Object.hasOwn(value, key));
}

function markConfirmedContracts(value) {
  if (Array.isArray(value)) return value.map(markConfirmedContracts);
  if (!isPlainObject(value)) return value;

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, markConfirmedContracts(child)]),
  );
  if (looksLikeChapterContract(normalized)) {
    normalized.status = 'confirmed';
    normalized.confirmed = true;
  }
  return normalized;
}

function contractFromContainer(container, requestedChapterId) {
  if (!isPlainObject(container)) return null;
  const selected = container.selectedChapter;
  const candidates = [
    container.selectedChapterContract,
    container.selectedChapterContractCandidate,
    container.nextChapterContract,
    container.nextChapterContractCandidate,
    container.chapterContract,
    container.contract,
    isPlainObject(selected) ? selected.contract || selected : null,
  ];
  let contract = candidates.find(hasContractValue);

  if (!contract) {
    const collection = Array.isArray(container.chapterContracts)
      ? container.chapterContracts
      : Array.isArray(container.chapters)
        ? container.chapters
        : [];
    const selectedId = requestedChapterId
      || container.selectedChapterId
      || (typeof selected === 'string' ? selected : undefined);
    if (selectedId) {
      contract = collection.find((item) => (
        isPlainObject(item)
        && String(item.id ?? item.chapterId ?? item.number) === String(selectedId)
      ));
    } else if (collection.length === 1) {
      [contract] = collection;
    }
  }

  return contract;
}

function findConfirmedContract(confirmed, requestedChapterId) {
  const root = parseObject(confirmed);
  if (!root) return null;

  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!isPlainObject(value) || seen.has(value)) continue;
    seen.add(value);

    const contract = contractFromContainer(value, requestedChapterId);
    if (hasContractValue(contract)) return contract;
    if (depth === 0 && looksLikeChapterContract(value)) return value;
    if (depth >= 4) continue;

    for (const child of Object.values(value)) {
      if (isPlainObject(child)) queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

export function extractConfirmedContract(workspace, requestedChapterId) {
  const blueprint = workspace?.stages?.blueprint;
  if (blueprint?.status !== 'ready') return null;

  let contract = findConfirmedContract(blueprint.confirmed, requestedChapterId);
  if (!hasContractValue(contract)) {
    // Existing Workspaces may keep the author-written contract in blueprint.input.
    // The UI has always treated this field as the chapter-writing contract. Once
    // the whole blueprint stage is author-confirmed, the persisted input is also
    // an author-controlled formal source and can safely satisfy the writer gate.
    contract = blueprint.input?.chapterContract;
  }

  if (!hasContractValue(contract)) return null;
  if (isPlainObject(contract)) {
    const id = contract.id ?? contract.chapterId ?? contract.number;
    if (requestedChapterId && id !== undefined && String(id) !== String(requestedChapterId)) return null;
  }

  // Author confirmation is represented by the persisted parent blueprint:
  // stages.blueprint.status === "ready" plus stages.blueprint.confirmed.
  // Candidate metadata emitted by the model (for example status="candidate"
  // or confirmed=false) describes the suggestion before the author accepted it
  // and must not override that later author decision.
  return cloneJson(contract);
}

export function isChapterCycleWorkspace(workspace) {
  return Number(workspace?.chapterCycleVersion) === 1;
}

export function extractConfirmedCurrentChapterContract(workspace, requestedChapterId) {
  if (!isChapterCycleWorkspace(workspace)) return null;
  const currentChapter = workspace?.currentChapter;
  const currentNumber = Number(currentChapter?.number);
  if (!Number.isInteger(currentNumber) || currentNumber < 1) return null;
  if (requestedChapterId != null && String(requestedChapterId) !== String(currentNumber)) return null;

  const state = currentChapter?.contract;
  if (!isPlainObject(state) || state.status !== 'confirmed' || !hasContractValue(state.confirmed)) return null;
  const contract = state.confirmed;
  if (isPlainObject(contract)) {
    const rawChapterNumber = contract.chapterId ?? contract.chapterNumber ?? contract.number
      ?? (typeof contract.id === 'number' || /^\d+$/.test(String(contract.id ?? '')) ? contract.id : null);
    const contractNumber = Number(rawChapterNumber);
    if (rawChapterNumber != null && (!Number.isInteger(contractNumber) || contractNumber !== currentNumber)) return null;
  }
  return cloneJson(contract);
}

export function prepareConfirmedContractForWriter(contract) {
  if (typeof contract === 'string') return contract.trim();
  if (!isPlainObject(contract)) return contract;
  return markConfirmedContracts(cloneJson(contract));
}

export function prepareConfirmedBlueprintForWriter(confirmedBlueprint, { stripChapterContractCandidates = false } = {}) {
  const parsed = parseObject(confirmedBlueprint);
  if (!parsed) return confirmedBlueprint;
  if (stripChapterContractCandidates) return stripChapterContractCandidatesForWriter(parsed);
  return markConfirmedContracts(cloneJson(parsed));
}

function stripChapterContractCandidatesForWriter(value) {
  if (Array.isArray(value)) return value.map(stripChapterContractCandidatesForWriter);
  if (!isPlainObject(value)) return value;
  const chapterContractKeys = new Set([
    'selectedChapterContract', 'selectedChapterContractCandidate', 'nextChapterContract',
    'nextChapterContractCandidate', 'chapterContract', 'contract', 'chapterContracts', 'chapters',
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !chapterContractKeys.has(key))
      .map(([key, child]) => [key, stripChapterContractCandidatesForWriter(child)]),
  );
}
