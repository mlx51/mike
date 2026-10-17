/** Shared insets keep editor, overview, references, runs, and loading panes aligned. */
export const PLAYBOOK_PANE_HEADER_CLASS =
  "flex min-h-12 shrink-0 items-center gap-2 px-3 py-2";

export const PLAYBOOK_PANE_BODY_CLASS =
  "min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1.5";

// Rows add px-2, bringing their content to the same px-3 inset as the header.
export const PLAYBOOK_PANE_LIST_CLASS =
  "max-h-64 min-h-0 min-w-0 overflow-y-auto px-1 pb-3 @[48rem]:max-h-none @[48rem]:flex-1";
