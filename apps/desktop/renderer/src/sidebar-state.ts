export function sidebarLayoutClassName(collapsed: boolean): string {
    return collapsed ? 'app-shell sidebar-collapsed' : 'app-shell';
}

export function sidebarToggleLabel(collapsed: boolean): string {
    return collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}
