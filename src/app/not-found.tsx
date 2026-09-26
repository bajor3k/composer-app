// Custom 404 — Next's built-in not-found page injects a global body style
// (prefers-color-scheme black/white) that overrides the theme's
// `body { background: var(--background) }` and shows through the gutter
// around the floating sidebar. Rendering our own keeps every theme intact.
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 min-h-[60vh]">
      <div className="flex items-center gap-4">
        <span className="text-2xl font-medium text-black dark:text-white">404</span>
        <span className="h-8 w-px bg-black/20 dark:bg-white/20" />
        <span className="text-sm text-black/60 dark:text-white/60">This page could not be found.</span>
      </div>
    </div>
  );
}
