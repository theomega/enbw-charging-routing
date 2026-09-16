// Rasterises public/icon.svg into the PNGs the manifest and iOS reference.
// Needs rsvg-convert (Debian: librsvg2-bin, macOS: brew install librsvg).
//
// Three variants exist because the platforms mask icons differently:
//   - "any": the source SVG as-is, corners already rounded.
//   - "maskable": full-bleed square, glyph inset so Android's circle mask
//     (which keeps only the middle 80%) cannot clip the bolt.
//   - apple-touch-icon: full-bleed square too — iOS lays its own squircle over
//     the icon, so pre-rounded corners would show a dark halo at the edges.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const source = readFileSync(join(publicDir, 'icon.svg'), 'utf8')

const BACKGROUND = '#0b1220'
const MASKABLE_SCALE = 0.85

const glyph = source.match(/<path[^>]*\/>/)?.[0]
if (!glyph) throw new Error('no <path> found in icon.svg — the glyph markup changed')

const square = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
  `<rect width="512" height="512" fill="${BACKGROUND}"/>${inner}</svg>`

const targets = [
  { name: 'icon-192.png', size: 192, svg: source },
  { name: 'icon-512.png', size: 512, svg: source },
  { name: 'apple-touch-icon.png', size: 180, svg: square(glyph) },
  {
    name: 'icon-maskable-512.png',
    size: 512,
    svg: square(
      `<g transform="translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)">${glyph}</g>`,
    ),
  },
]

const scratch = mkdtempSync(join(tmpdir(), 'icons-'))
try {
  for (const { name, size, svg } of targets) {
    const input = join(scratch, `${name}.svg`)
    writeFileSync(input, svg)
    // --background-color keeps the PNGs opaque; iOS renders alpha as black.
    execFileSync('rsvg-convert', [
      '--width',
      String(size),
      '--height',
      String(size),
      '--background-color',
      BACKGROUND,
      '--output',
      join(publicDir, name),
      input,
    ])
    console.log(`${name} (${size}x${size})`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
