import type {LucideIcon} from 'lucide-react';
import {BookOpen, BriefcaseBusiness, Cpu, FlaskConical, Folder, Globe2, Leaf, Newspaper, Palette} from 'lucide-react';
import type {CollectionIcon} from '@rss-reader/contracts';

export const collectionIconOptions: ReadonlyArray<{key: CollectionIcon; label: string; Icon: LucideIcon}> = [
  {key: 'folder', label: 'General', Icon: Folder},
  {key: 'business', label: 'Business', Icon: BriefcaseBusiness},
  {key: 'technology', label: 'Technology', Icon: Cpu},
  {key: 'science', label: 'Science', Icon: FlaskConical},
  {key: 'nature', label: 'Nature', Icon: Leaf},
  {key: 'design', label: 'Design', Icon: Palette},
  {key: 'news', label: 'News', Icon: Newspaper},
  {key: 'world', label: 'World', Icon: Globe2},
  {key: 'learning', label: 'Learning', Icon: BookOpen},
];

export function CollectionIconGlyph({icon, size = 18}: {icon: CollectionIcon; size?: number}) {
  const Icon = collectionIconOptions.find((option) => option.key === icon)?.Icon ?? Folder;
  return <Icon size={size} aria-hidden="true"/>;
}
