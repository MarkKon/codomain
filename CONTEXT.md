# Codomain

Codomain is a desktop writing environment that binds a window to a root folder, runs Neovim there, and shows the active Markdown file beside it.

## Language

**Root Folder**:
The folder that defines the workspace boundary for a Codomain window.
_Avoid_: workspace, project root

**App Shell**:
The part of Codomain that owns window-level behavior: root folder selection, Neovim session, terminal pane, view mode, menus, and wiring between subsystems.
_Avoid_: main module, application layer

**Markdown File**:
A Markdown document inside the **Root Folder** that can be shown in the preview.
_Avoid_: note, buffer

**Active Markdown File**:
The **Markdown File** currently selected by Neovim and eligible to be shown in the preview.
_Avoid_: active buffer, current buffer

**Displayed Markdown File**:
The **Markdown File** currently shown by the **Markdown Preview**.
_Avoid_: current preview state

**Markdown Preview**:
The right-pane experience for a **Markdown File**, including rendered content, wikilink interaction, math display, empty states, and errors.
_Avoid_: renderer

**Preview Refresh**:
The act of updating the **Markdown Preview** from the **Active Markdown File**.
_Avoid_: sync, synchronization

**Preview Scroll Following**:
The act of scrolling the **Markdown Preview** to follow the Neovim cursor source line in the **Active Markdown File**.
_Avoid_: scroll sync

**Preview Jump**:
The act of moving the Neovim cursor to the source line selected in the **Markdown Preview**.
_Avoid_: reverse sync, markdown-to-Neovim scroll sync

**Source Line Mapping**:
Source-line metadata emitted during **Markdown Rendering** that associates rendered Markdown blocks with source lines in a **Markdown File**.
_Avoid_: text matching

**Markdown Rendering**:
The conversion of Markdown content into previewable HTML.
_Avoid_: preview

**Wikilink**:
An Obsidian-style link in a **Markdown File** that targets another Markdown file inside the **Root Folder**.
_Avoid_: link, internal link

**Wikilink Resolution**:
The act of finding the target **Markdown File** for a **Wikilink** from a source **Markdown File**.
_Avoid_: link handling

## Relationships

- The **App Shell** owns the **Root Folder**, Neovim session, terminal pane, view mode, menus, and subsystem wiring.
- A **Root Folder** contains zero or more **Markdown Files**.
- Neovim identifies at most one **Active Markdown File** for a **Preview Refresh**.
- A **Markdown Preview** presents at most one **Displayed Markdown File**.
- The **Displayed Markdown File** should normally match the **Active Markdown File**.
- The **Markdown Preview** owns whether a supplied **Markdown File** is already the **Displayed Markdown File**.
- **Markdown Rendering** is one responsibility inside the broader **Markdown Preview**.
- A **Wikilink** resolves from the current **Markdown File** to another **Markdown File**.
- **Wikilink Resolution** belongs outside the **Markdown Preview** because it depends on **Root Folder** lookup and file safety rules.
- The **App Shell** discovers the **Active Markdown File**; the **Markdown Preview** displays a supplied **Markdown File**.
- **Preview Scroll Following** is continuous and line-level from Neovim to the **Markdown Preview**.
- **Preview Jump** is explicit and line-level from the **Markdown Preview** to Neovim.
- **Markdown Rendering** emits **Source Line Mapping** metadata.
- The **Markdown Preview** uses **Source Line Mapping** for line-level block lookup in **Preview Scroll Following** and **Preview Jump**.
- A **Preview Refresh** does not by itself perform **Preview Scroll Following**.
- Neovim cursor-line changes are separate from **Preview Refresh** signals.
- Startup and root changes open `README.md` in Neovim when it exists so the **Displayed Markdown File** and **Active Markdown File** match.
- Manual scrolling in the **Markdown Preview** is respected until the Neovim cursor actually moves.
- Same-line edits and **Preview Refresh** preserve the current **Markdown Preview** scroll position.
- A **Preview Jump** moves Neovim without immediately re-scrolling the **Markdown Preview**.
- A **Preview Jump** targets the start line of the selected rendered block.
- **Preview Jump** applies to non-interactive rendered content and does not override **Wikilink** or normal link interaction.
- **Preview Jump** may target the nearest rendered block when the selected point is between blocks inside the rendered document flow.
- **Preview Jump** may defensively activate the **Displayed Markdown File**, but that is recovery behavior rather than the normal model.
- **Preview Scroll Following** avoids scrolling when the target rendered block is already comfortably visible.
- The current refactor extracts the existing **Markdown Preview** behavior without changing Markdown syntax or rendering semantics.

## Example dialogue

> **Dev:** "When the user clicks a **Wikilink**, is that part of **Markdown Rendering**?"
> **Domain expert:** "No. **Markdown Rendering** produces the HTML, but the **Markdown Preview** owns the right-pane interaction and asks the app to open the target."

## Flagged ambiguities

- "preview" was used to mean both the rendered HTML and the whole right pane; resolved: **Markdown Preview** is the right-pane experience, while **Markdown Rendering** is content-to-HTML conversion.
- "active buffer" referred to a Neovim implementation concept; resolved: use **Active Markdown File** when discussing Codomain behavior.
- "sync" and "synchronization" were too broad; resolved: use **Preview Refresh** for updating the **Markdown Preview** from the **Active Markdown File**.
- "scroll sync" was too broad; resolved: use **Preview Scroll Following** for Neovim-to-preview movement and **Preview Jump** for explicit preview-to-Neovim movement.
