import type { Project } from '@/shared/types';
import { clearTextCache } from './textRender';

// Custom font files for titles. A project remembers { family, path } pairs; on open (and when
// the user picks a file in the Title Studio) they are registered with the CSS Font Loading API
// so canvas text can use the family name like any installed font.

const loaded = new Map<string, Promise<boolean>>();

export const fontFamilyFromPath = (path: string) => path.replace(/\\/g, '/').split('/').pop()!.replace(/\.(ttf|otf|woff2?)$/i, '');

export function loadFont(family: string, path: string): Promise<boolean> {
  const key = `${family}|${path}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const url = `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`;
      const face = new FontFace(family, `url("${encodeURI(url)}")`);
      await face.load();
      document.fonts.add(face);
      clearTextCache(); // static renders made with the fallback font are stale now
      return true;
    } catch (e) {
      console.warn(`[fonts] could not load ${path}:`, e);
      loaded.delete(key);
      return false;
    }
  })();
  loaded.set(key, p);
  return p;
}

export async function loadProjectFonts(project: Project): Promise<void> {
  await Promise.all((project.fonts ?? []).map((f) => loadFont(f.family, f.path)));
}
