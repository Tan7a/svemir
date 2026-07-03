/**
 * Required fallback for the @modal slot. Renders null when no intercepted
 * route is active - i.e. during initial page load or full-page refresh.
 *
 * See: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md
 */
export default function ModalDefault() {
  return null;
}
