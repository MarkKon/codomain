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
- The **Markdown Preview** owns whether a supplied **Markdown File** is already the **Displayed Markdown File**.
- **Markdown Rendering** is one responsibility inside the broader **Markdown Preview**.
- A **Wikilink** resolves from the current **Markdown File** to another **Markdown File**.
- **Wikilink Resolution** belongs outside the **Markdown Preview** because it depends on **Root Folder** lookup and file safety rules.
- The **App Shell** discovers the **Active Markdown File**; the **Markdown Preview** displays a supplied **Markdown File**.
- The current refactor extracts the existing **Markdown Preview** behavior without changing Markdown syntax or rendering semantics.

## Example dialogue

> **Dev:** "When the user clicks a **Wikilink**, is that part of **Markdown Rendering**?"
> **Domain expert:** "No. **Markdown Rendering** produces the HTML, but the **Markdown Preview** owns the right-pane interaction and asks the app to open the target."

## Flagged ambiguities

- "preview" was used to mean both the rendered HTML and the whole right pane; resolved: **Markdown Preview** is the right-pane experience, while **Markdown Rendering** is content-to-HTML conversion.
- "active buffer" referred to a Neovim implementation concept; resolved: use **Active Markdown File** when discussing Codomain behavior.
- "sync" and "synchronization" were too broad; resolved: use **Preview Refresh** for updating the **Markdown Preview** from the **Active Markdown File**.
