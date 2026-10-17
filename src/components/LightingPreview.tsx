import { useEffect, useState } from 'preact/hooks';
import { lightingFrame, type LightingSnapshot } from '../domain/lighting';

export default function LightingPreview({ lighting, eventMs, timeScale, running }: { lighting?: LightingSnapshot; eventMs: number; timeScale: number; running: boolean }) {
  const [time, setTime] = useState(eventMs);
  useEffect(() => {
    setTime(eventMs);
    if (!running || timeScale === 0) return;
    const start = performance.now();
    let frame: number;
    const tick = () => { setTime(eventMs + (performance.now() - start) * timeScale); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [eventMs, timeScale, running]);
  const rendered = lighting && lightingFrame(lighting, Math.max(eventMs, time));
  const label = lighting?.status === 'synced' ? 'Synced' : lighting?.status === 'paused' ? 'Paused' : 'Waiting for sync';
  return (
    <section class="deck-card lighting-panel" aria-labelledby="lighting-heading">
      <header class="deck-card__header">
        <div><h2 id="lighting-heading">Lighting</h2><p class="mixer-note">Preview · No hardware output</p></div>
        <span class={`status ${lighting?.status === 'synced' ? 'status--active' : ''}`}>{label}</span>
      </header>
      <p class="lighting-source">{lighting?.player != null ? `Player ${lighting.player}` : 'No tempo master'} · {lighting?.tempo == null ? 'BPM unknown' : `${lighting.tempo.toFixed(2)} BPM`} · {lighting?.phrase ?? 'Default palette'} · {{ fan: 'Fanning', groups: 'Group exchange', all: 'All spots', wash: 'Soft wash' }[lighting?.pattern ?? 'fan']}</p>
      <div class="lighting-rig">
        {(['left', 'right'] as const).map(side => (
          <div class="lighting-bank" key={side} role="group" aria-label={`${side === 'left' ? 'Left' : 'Right'} RGB-PAR spots`}>
            <h3>{side === 'left' ? 'Left' : 'Right'}</h3>
            <div class="lighting-spots">{rendered?.spots.filter(spot => spot.side === side).map(spot => (
              <div class="lighting-spot" key={spot.id} data-spot={spot.id} data-lit={spot.intensity > 0 ? 'true' : 'false'}>
                <span class="lighting-lens" style={{ '--spot-color': `rgb(${spot.color.map(channel => Math.round(channel * spot.intensity)).join(',')})` }} aria-hidden="true" />
                <span>{spot.id}</span>
                <span class="sr-only">{spot.intensity > 0 ? `RGB ${spot.color.join(', ')}, ${Math.round(spot.intensity * 100)}%` : 'Off'}</span>
              </div>
            ))}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
