export function createPipeSentinel(source) {
  let nonce = 0;
  let candidate = "CDWIKIPIPE0TOKEN";
  while (source.includes(candidate)) {
    nonce += 1;
    candidate = `CDWIKIPIPE${nonce}TOKEN`;
  }
  return candidate;
}

export function protectWikilinkPipes(source, sentinel) {
  return source.replace(/\[\[[\s\S]*?\]\]/g, (token) => token.replaceAll("|", sentinel));
}
