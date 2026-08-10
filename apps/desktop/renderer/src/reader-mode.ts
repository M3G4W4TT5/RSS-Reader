export function readerGridClassName(expanded: boolean): string {
    return expanded ? 'reader-grid reader-expanded' : 'reader-grid';
}

export function readerModeLabel(expanded: boolean): string {
    return expanded ? 'Exit fullscreen reader mode' : 'Enter fullscreen reader mode';
}
