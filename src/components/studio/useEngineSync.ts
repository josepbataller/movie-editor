import { useEffect } from 'react';
import { useStudio, sessionDuration } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { getEngine } from '@/engine/audio/engine';

/**
 * Keeps the Web Audio engine in sync with the studio store:
 *  - session changes  -> engine.apply() (graph/params) + preload sample buffers
 *  - playing flag     -> engine.play()/stop()
 *  - seeks while stopped -> engine.seek()
 *  - while playing, the store's currentTime follows the engine clock (rAF)
 */
export function useEngineSync() {
  useEffect(() => {
    const engine = getEngine();
    let rafId = 0;
    let lastSeekFromStore = -1;

    const applySession = () => {
      const st = useStudio.getState();
      const assets = useProject.getState().project.assets;
      engine.apply(st.session, assets);
      void engine.preload(st.session, assets);
    };
    applySession();

    const unsub = useStudio.subscribe((s, prev) => {
      if (s.session !== prev.session) applySession();
      if (s.playing !== prev.playing) {
        if (s.playing) void engine.play(s.currentTime);
        else engine.stop();
      } else if (s.currentTime !== prev.currentTime && s.currentTime !== lastSeekFromStore) {
        engine.seek(s.currentTime); // user seek (ruler, keys) — also while playing
      }
    });
    const unsubAssets = useProject.subscribe((s, prev) => {
      if (s.project.assets !== prev.project.assets) applySession();
    });

    engine.onLoop = () => { /* position restarts inside the engine; rAF picks it up */ };

    const tick = () => {
      const st = useStudio.getState();
      if (st.playing && engine.playing) {
        const pos = engine.position();
        const end = sessionDuration(st.session);
        if (!st.session.loop.enabled && end > 0 && pos >= end + 0.5) {
          st.setPlaying(false);
          st.setCurrentTime(end);
        } else {
          lastSeekFromStore = pos;
          st.setCurrentTime(pos);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      unsub(); unsubAssets();
      cancelAnimationFrame(rafId);
      engine.stop();
      useStudio.getState().setPlaying(false);
    };
  }, []);
}
