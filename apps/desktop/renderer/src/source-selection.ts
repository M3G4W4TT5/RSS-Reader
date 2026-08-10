export function toggleSourceSelection(selected: ReadonlySet<string>, id: string): Set<string> {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
}

export function selectAllSources(ids: readonly string[]): Set<string> {
    return new Set(ids);
}

export function pruneSourceSelection(selected: ReadonlySet<string>, availableIds: readonly string[]): Set<string> {
    const available = new Set(availableIds);
    return new Set([...selected].filter((id) => available.has(id)));
}
