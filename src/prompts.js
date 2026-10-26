const BG = "The background must be flat, solid, pure magenta (#FF00FF). Never use magenta or pink tones on the subject itself.";
const PIXEL = "Crisp hard-edged pixel art: no anti-aliasing, no blur, no gradients, no glow, no soft shadows, no text, no watermark.";

export function designPrompt(user, style) {
  return `Image 1 is a bare pixel-art base character (front view) on a flat magenta background.
Redraw this exact character dressed and equipped as follows: ${user}

Rules:
- Keep the body pose, proportions, head size, camera angle and pixel scale exactly as in image 1.
- Keep the character at exactly the same position and size on the canvas. Do not zoom, crop or move it.
- Only add clothing, hair, and the requested accessories or tools.
${style ? `- Style notes: ${style}\n` : ""}- ${PIXEL}
- ${BG}`;
}

export function dressPrompt({ user, count, cols, rows, hasAnchor }) {
  return `Image 1 is a ${cols}x${rows} grid (${count} used cells) of a bare pixel-art base character in different poses and facing directions, on a magenta background with grey cell borders.
Image 2 shows the outfit design (front view): ${user}
${hasAnchor ? "Image 3 is an already-approved result for other poses of the same character. Match its colours and details exactly.\n" : ""}
Redraw image 1 with every character wearing the outfit from image 2.

Rules:
- Same grid, same cell borders, same number of cells. One character per cell.
- Each character keeps its exact pose, facing direction, size and position inside its cell. Only add clothes, hair and accessories.
- For side and back views, infer the back and sides of the outfit consistently (hair from behind, back of clothing, etc.).
- Identical outfit, colours and palette in every cell.
- ${PIXEL}
- ${BG}`;
}

export function tilePrompt({ user, items, cols, rows, style, hasAnchor }) {
  const list = items
    .map((it, i) => `- Cell ${i + 1} (row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}): ${it.desc} [${it.kind === "tile" ? "seamless tile that fills the WHOLE cell edge to edge" : "single object centred on the magenta background, resting on its bottom edge"}]`)
    .join("\n");
  return `Draw a ${cols}x${rows} grid of game environment art for: ${user}. Top-down / three-quarter pixel-art game view, consistent palette and lighting across all cells. The grid has grey borders; one item per cell, nothing crossing a border.
${hasAnchor ? "Image 1 is an approved result from the same set: match its palette, perspective and style exactly.\n" : ""}
Cells:
${list}

Rules:
${style ? `- Style notes: ${style}\n` : ""}- ${PIXEL}
- Objects sit on a flat magenta (#FF00FF) background; never use magenta on the objects. Floor/wall tiles fill their whole cell with no background.`;
}
