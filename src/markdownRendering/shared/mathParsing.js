export function isAlphaNumeric(code) {
  if (typeof code !== "number") return false;
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

export function isEscapedByOddBackslashes(src, index) {
  let count = 0;
  let i = index - 1;
  while (i >= 0 && src.charCodeAt(i) === 0x5c) {
    count += 1;
    i -= 1;
  }
  return count % 2 === 1;
}
