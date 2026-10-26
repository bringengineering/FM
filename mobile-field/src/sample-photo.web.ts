export function samplePhoto(): { uri: string; width: number; height: number } {
  const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 540;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8eef4'; ctx.fillRect(0, 0, 720, 540);
  ctx.fillStyle = '#cad8e2'; ctx.fillRect(80, 60, 560, 440);
  ctx.fillStyle = '#394c63'; ctx.fillRect(265, 140, 190, 360);
  ctx.fillStyle = '#96bbce'; ctx.fillRect(280, 155, 160, 285);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.fillText('TEST · SAMPLE', 224, 95);
  ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif'; ctx.fillText('Synthetic image — no real site', 200, 522);
  return { uri: canvas.toDataURL('image/jpeg', 0.85), width: 720, height: 540 };
}
