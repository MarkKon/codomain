import { escapeHtml } from "../../markdownEscaping.js";

export function installWikilinkExtension(markdown, getActivePipeSentinel) {
  markdown.core.ruler.after("inline", "codomain_wikilink", (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== "inline" || !Array.isArray(blockToken.children)) continue;
      blockToken.children = expandWikilinks(
        blockToken.children,
        state.Token,
        getActivePipeSentinel(),
      );
    }
  });

  markdown.renderer.rules.codomain_wikilink = (tokens, idx) => {
    const target = tokens[idx].meta.target;
    const label = tokens[idx].meta.label || target;
    return `<a href="#" data-wikilink="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
  };

  markdown.renderer.rules.codomain_embed_image = (tokens, idx) => {
    const src = tokens[idx].meta.src;
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(src)}">`;
  };
}

function expandWikilinks(children, Token, sentinel) {
  const transformed = [];
  let linkDepth = 0;

  for (const child of children) {
    if (child.type === "link_open") {
      linkDepth += 1;
      transformed.push(child);
      continue;
    }
    if (child.type === "link_close") {
      linkDepth = Math.max(0, linkDepth - 1);
      transformed.push(child);
      continue;
    }
    if (child.type === "image" || linkDepth > 0 || child.type !== "text") {
      transformed.push(child);
      continue;
    }

    const parts = splitTextByEmbedsAndWikilinks(child.content, sentinel);
    if (parts.length === 1 && parts[0].type === "text") {
      transformed.push(child);
      continue;
    }

    for (const part of parts) {
      if (part.type === "text") {
        const token = new Token("text", "", 0);
        token.content = part.content;
        transformed.push(token);
      } else if (part.type === "wikilink") {
        const token = new Token("codomain_wikilink", "", 0);
        token.meta = { target: part.target, label: part.label };
        transformed.push(token);
      } else {
        const token = new Token("codomain_embed_image", "img", 0);
        token.meta = { src: part.target };
        transformed.push(token);
      }
    }
  }

  return transformed;
}

function splitTextByEmbedsAndWikilinks(content, sentinel) {
  const parts = [];
  const pattern = /(!)?\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match = pattern.exec(content);

  while (match) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    const body = match[2];
    const sep = sentinel ? body.indexOf(sentinel) : -1;
    if (match[1] === "!") {
      if (sep >= 0) {
        parts.push({ type: "text", content: match[0] });
      } else {
        parts.push({ type: "embed_image", target: body });
      }
    } else if (sep >= 0) {
      parts.push({
        type: "wikilink",
        target: body.slice(0, sep),
        label: body.slice(sep + sentinel.length),
      });
    } else {
      parts.push({ type: "wikilink", target: body });
    }
    lastIndex = pattern.lastIndex;
    match = pattern.exec(content);
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", content }];
}
