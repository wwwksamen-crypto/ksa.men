export type ManagedBlock = { kind: 'paragraph' | 'heading'; text: string };

/** Display-only normalization for managed public copy; never applied to user drafts. */
export function managedText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n?/g, '\n').trim();
}

export function managedBlocks(value: unknown): ManagedBlock[] {
  return managedText(value).split(/\n\s*\n/).filter(Boolean).map(part => {
    const heading = /^#{2,3}\s+([^\n]+)$/.exec(part.trim());
    return { kind: heading ? 'heading' : 'paragraph', text: heading ? heading[1] : part.trim() };
  });
}
