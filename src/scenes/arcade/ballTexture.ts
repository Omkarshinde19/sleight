import * as THREE from "three";

/** Basketball skin drawn on a canvas: ember leather, pebble noise and dark seams. */
export function makeBallTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#ff7a4a");
  grad.addColorStop(0.5, "#e2553a");
  grad.addColorStop(1, "#b83a26");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // pebbling
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.strokeStyle = "#1a0d0a";
  g.lineWidth = 9;
  g.lineCap = "round";
  // equator and two meridians
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W, H / 2);
  for (const u of [0.25, 0.75]) {
    g.moveTo(u * W, 0);
    g.lineTo(u * W, H);
  }
  g.stroke();
  // the two curved seams
  for (const u0 of [0, 0.5]) {
    g.beginPath();
    for (let y = 0; y <= H; y += 4) {
      const t = y / H;
      const x = (u0 + 0.25 + 0.11 * Math.sin(t * Math.PI * 2)) * W;
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
