/**
 * Part-of-speech word codes inserted by "Insert POS Codes" (e.g. dog[N], run/3s[V]).
 * Kept in a dependency-free module so every SALT parser can strip them without import cycles.
 * None start with "E" (never counted as SALT error codes) and none collide with SALT or
 * clause codes ([X], [I], [F], [CS], [WO], [FP], [MC], [SC], [RC], [AC], [NC], [CL], [SI-*]).
 */
export const POS_CODE_RE = /\[(?:N|V|AUX|PRO|ADJ|ADV|DET|PREP|CONJ|NUM|INT|OTH)\]/g;

/** Removes inserted part-of-speech codes, leaving all other SALT coding intact. */
export function stripPosCodes(text: string): string {
  return text.replace(POS_CODE_RE, '');
}

export function hasPosCodes(text: string): boolean {
  return text.replace(POS_CODE_RE, '') !== text;
}
