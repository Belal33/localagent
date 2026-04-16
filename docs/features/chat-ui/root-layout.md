# Root Layout

Minimal Next.js root layout loading Geist Sans / Geist Mono fonts and global Tailwind styles.
Wraps all routes.

Implemented in `src/app/layout.tsx` and `src/app/globals.css`. Uses `next/font/google`
for Geist, sets `antialiased` on the body, and applies the global emerald-on-neutral
terminal aesthetic. **Note:** metadata `title` is still the Next.js scaffold default
("Create Next App") — update when productionizing.
