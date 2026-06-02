# TODO

## Architecture Deepening Handoffs

- [x] Explore Markdown preview rendering module: [/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.hAoECPzIxU](/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.hAoECPzIxU)
- [x] Explore root-bound note resolution module: [/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.BqiXZRApks](/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.BqiXZRApks)
- [x] Explore Neovim session module: [/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.SbZp1ZfBSQ](/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.SbZp1ZfBSQ)
- [x] Explore view command and mode module: [/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.002a4sbuYy](/var/folders/c0/pm06tc9x169cncy3cllv7c6w0000gn/T/handoff-XXXXXX.md.002a4sbuYy)
- [x] Add back and forth buttons for the markdown (and update the buffer accordingly) -> Also add support for this using mac-native back and forth (so it works e.g. with the mouse buttons etc.)
- [x] Keep "focus" on the nvim instance so that edits etc. always happen directly, i.e. that even after clicking on the md preview one can directly use the nvim input without having to click on it again.
- [x] Explore how to best render md. Currently mostly a custom implementation? But I guess in the end, it would be best to just use a dependency? (Result: keep custom renderer; add Markdown Rendering seam; no dependency added.)
- [ ] Explore possibility to use themes? -> allow css config in the `.config` folder.
- [ ] Explore exactly how to publish as an app through gh and then kind of make it installable through a command etc.
- [ ] Implement image embedding
- [ ] Implement double clicking on a section and moving the nvim cursor to that section.
- [ ] Implement "open here" command that can also be launched from nvim -> find good root folder, launch the file currently editing (is there maybe even a way to catch the buffer?)
