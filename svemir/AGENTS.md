<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Visual rules

- **NEVER add a glow effect. Anywhere. Ever.** No bloom, no neon halos, no glowing shadows — not in CSS (`box-shadow`/`filter: drop-shadow`/`text-shadow` used as glow), not in Canvas (`shadowBlur`), not in Three.js/WebGL (bloom passes, emissive glow, additive haze). The whole app is flat and matte by deliberate design. If an effect would make something "light up" or radiate, do not add it.

# Copy rules

- **NEVER use em dashes (`—`) in copy.** Not in UI text, page intros, descriptions, button labels, or any user-facing writing. Use a comma, colon, parentheses, or a separate sentence instead. (Ordinary hyphens in compound words like "AI-UX" are fine.)
