// Local editor identities never enter a saved/public profile.
export class EditorRowKeys {
  private sequence = 0;
  private keys: string[] = [];
  resize(length: number): string[] {
    while (this.keys.length < length) this.keys.push(`row-${++this.sequence}`);
    this.keys.length = length;
    return [...this.keys];
  }
  remove(index: number) { this.keys.splice(index, 1); }
  move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= this.keys.length || to >= this.keys.length) return;
    const [key] = this.keys.splice(from, 1);
    this.keys.splice(to, 0, key);
  }
}

export function appendImage(items: string[], url: string, maximum: number): string[] {
  if (items.includes(url)) return items;
  if (items.length >= maximum) throw new Error('IMAGE_LIST_FULL');
  return [...items, url];
}

export function safeLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
