import { Config } from './Config';

/**
 * Dev-only tuning panel (?debug). lil-gui is imported dynamically so it never lands in the
 * main bundle for players. Ranges are guessed from each value's magnitude.
 */
export async function createDebugPanel(
  extra: (gui: import('lil-gui').default) => void,
): Promise<void> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'Driftwing tuning' });
  gui.close();
  for (const [groupName, group] of Object.entries(Config)) {
    const folder = gui.addFolder(groupName);
    folder.close();
    const g = group as Record<string, number | boolean>;
    for (const [key, value] of Object.entries(g)) {
      if (typeof value === 'boolean') {
        folder.add(g, key);
      } else if (typeof value === 'number') {
        const mag = Math.abs(value) || 1;
        const lo = value < 0 ? -mag * 3 : 0;
        const hi = value <= 1 && value >= 0 ? Math.max(1, value * 4) : mag * 3;
        folder.add(g, key, lo, hi, Number.isInteger(value) && mag >= 10 ? 1 : 0.01);
      }
    }
  }
  extra(gui);
}
