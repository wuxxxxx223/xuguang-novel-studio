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

export function extractConfirmedContract(workspace, requestedChapterId) {
  const blueprint = workspace?.stages?.blueprint;
  if (blueprint?.status !== 'ready' || !isPlainObject(blueprint.confirmed)) return null;

  const confirmed = blueprint.confirmed;
  const selected = confirmed.selectedChapter;
  const candidates = [
    confirmed.selectedChapterContract,
    confirmed.selectedChapterContractCandidate,
    confirmed.nextChapterContract,
    confirmed.nextChapterContractCandidate,
    confirmed.chapterContract,
    confirmed.contract,
    isPlainObject(selected) ? selected.contract || selected : null,
  ];
  let contract = candidates.find(hasContractValue);

  if (!contract) {
    const collection = Array.isArray(confirmed.chapterContracts)
      ? confirmed.chapterContracts
      : Array.isArray(confirmed.chapters)
        ? confirmed.chapters
        : [];
    const selectedId = requestedChapterId
      || confirmed.selectedChapterId
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
