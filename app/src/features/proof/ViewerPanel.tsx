import { useMemo, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { fmtDec, fmtNum, fmtRa } from '@/lib/format';
import { cuts, flagNames } from '@/lib/image';
import type { Cutout } from '@/lib/types';
import { useApp } from '@/state/store';
import { FitsView, type HoverInfo } from '../viewer/FitsView';

export function ViewerPanel({ cutout }: { cutout: Cutout }) {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [lo, hi] = useMemo(() => cuts(cutout.image, view.cut), [cutout, view.cut]);
  const unit = cutout.bunit ?? '';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" aria-label="Display settings (display only: the data are not changed)">
        <Segmented label="Stretch" value={view.stretch} onChange={(stretch) => setView({ stretch })}
          options={[{ value: 'linear', label: 'Linear' }, { value: 'asinh', label: 'Asinh' }, { value: 'log', label: 'Log' }, { value: 'sqrt', label: 'Sqrt' }]} />
        <Segmented label="Range" value={view.cut} onChange={(cut) => setView({ cut })}
          options={[{ value: 'p99.5', label: '99.5%' }, { value: 'p99', label: '99%' }, { value: 'sigma', label: '−2σ…+8σ', title: 'Median − 2σ to median + 8σ (robust σ)' }, { value: 'minmax', label: 'Min–max' }]} />
        <Segmented label="Colours" value={view.colormap} onChange={(colormap) => setView({ colormap })}
          options={[{ value: 'inferno', label: 'Inferno' }, { value: 'gray', label: 'Grey' }]} />
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-2">
          <Switch checked={view.showFlags} onCheckedChange={(showFlags) => setView({ showFlags })} aria-describedby="flags-note" />
          Bad pixels
        </label>
      </div>
      <div className="relative min-h-[260px] flex-1 rounded-panel border border-line bg-bg-2 p-2">
        <FitsView cutout={cutout} lo={lo} hi={hi} stretch={view.stretch} colormap={view.colormap} showFlags={view.showFlags} flagMask={cutout.flags.bad_mask} onHover={setHover} />
      </div>
      <p id="flags-note" className="sr-only">Tints pixels whose quality flags mark them as unreliable, using the bit names stored in the file.</p>
      <div className="min-h-[3.25rem] rounded-ctl border border-line bg-panel px-3 py-2 font-mono text-xs text-ink-2" aria-live="polite">
        {hover ? (
          <>
            <span className="text-ink">pixel ({hover.x}, {hover.y})</span>{'  '}
            {Number.isFinite(hover.value) ? <span className="text-ink">{fmtNum(hover.value, 3)} {unit}</span> : <span className="text-ink-3">blank: not measured</span>}
            {hover.sigma !== null && Number.isFinite(hover.value) && <span> ± {fmtNum(hover.sigma, 3)}</span>}{'  '}
            <span>RA {fmtRa(hover.ra)} Dec {fmtDec(hover.dec)}</span>
            <span className="block truncate text-ink-3">flags: {hover.flags < 0 ? 'none read' : flagNames(hover.flags, cutout.flags.definitions).join(', ') || 'none'}{' · RA/Dec approximate (local linear WCS)'}</span>
          </>
        ) : (
          <span className="text-ink-3">Point at the image to read a pixel: value in {unit || 'file units'}, its 1σ uncertainty from the VARIANCE layer, sky position and quality flags. Amber ring: the target on this date.</span>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Display range {fmtNum(lo, 2)} to {fmtNum(hi, 2)} {unit}. Shown as stored: array row 0 at the bottom (FITS convention), not rotated north-up. {cutout.stats.nan_pixels > 0 && `${cutout.stats.nan_pixels} pixels are blank in SPHEREx (saturated or missing) and stay blank.`}
      </p>
    </div>
  );
}
