// DEPRECATED — do not add this to a tool list.
//
// This was a "read-only" git tool, intended as a safety boundary. It
// wasn't one: the model has an unrestricted shellTool sitting right next
// to it and simply used that for `git clone` instead (confirmed in
// practice). A restricted tool next to an unrestricted one constrains
// nothing. See the note at the top of shell.ts for the actual approach.
//
// Kept as a record of the decision, not something to wire up. All git
// operations now go through shellTool.
export {};