/**
 * Catch-all for the @modal slot. On soft (client-side) navigation to any route
 * the slot doesn't intercept - e.g. clicking a channel link inside the block
 * popup and landing on /channel/[slug] - Next.js would otherwise keep the
 * popup's last active content visible. Matching this null-returning route
 * dismisses the popup so the destination page shows cleanly. The intercepting
 * (.)block / (.)facet routes are more specific and still win when opening a
 * popup.
 *
 * See: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md
 *      ("Closing the modal")
 */
export default function ModalCatchAll() {
  return null;
}
