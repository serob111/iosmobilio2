function stripDiacritics(input: string): string {
  try {
    const normalized = input.normalize('NFKD');
    let result = '';
    for (const ch of normalized) {
      const code = ch.codePointAt(0) ?? 0;
      // Combining diacritical marks block (U+0300-U+036F): drop them, keep the base letter.
      if (code >= 0x0300 && code <= 0x036f) continue;
      result += ch;
    }
    return result;
  } catch {
    return input;
  }
}

/** Turns an arbitrary string (site name, hostname) into a schema-valid slug. */
export function slugify(input: string): string {
  const slug = stripDiacritics(input.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'app';
}
