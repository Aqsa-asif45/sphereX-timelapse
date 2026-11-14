import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Observation, SearchResult } from '@/lib/types';
import { useApp } from '@/state/store';
import { ObservationList } from './ObservationList';

const obs = (release: string, mjd: number, det: number): Observation => ({
  obs_id: `${release}-${mjd}`, release, collection: `spherex_${release}`, survey: 'wide', week: '2025W33_2C', large_slew: mjd, small_slew: 1, detector: det,
  mjd, utc: '', lambda_min_um: 1.1, lambda_max_um: 1.6, access_url: `https://irsa.ipac.caltech.edu/ibe/data/spherex/${release}/${mjd}.fits`, cutout_capable: true,
  pipeline: 'l2b', version: 'v27', processing_date: '2026-08-16', adapter: 'IRSA SIA2', retrieved_utc: '2026-11-14T12:00:00Z',
});

const result: SearchResult = {
  ra: 1, dec: 1, radius_deg: 0.0005, collections: ['spherex_dr1', 'spherex_qr3'], adapter: 'IRSA SIA2', complete: true, count: 3,
  by_release: { dr1: 2, qr3: 1 }, observations: [obs('dr1', 60900, 1), obs('dr1', 60901, 2), obs('qr3', 61270, 2)],
  errors: {}, notes: [], elapsed_s: 4.2, retrieved_utc: '2026-11-14T12:00:00Z',
};

describe('ObservationList', () => {
  beforeEach(() => useApp.setState({ selected: null }));

  it('groups exposures by release with counts and provenance', () => {
    render(<ObservationList result={result} />);
    expect(screen.getByText('DR1 · Data Release 1 · 2')).toBeInTheDocument();
    expect(screen.getByText('QR3 · Quick Release 3 · 1')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getAllByText(/v27 \(2026-08-16\)/)).toHaveLength(3);
  });

  it('selects an exposure, and the release shortcuts pick that release', () => {
    render(<ObservationList result={result} />);
    fireEvent.click(screen.getByRole('button', { name: 'First QR3 (1)' }));
    expect(useApp.getState().selected?.release).toBe('qr3');
    fireEvent.click(screen.getAllByRole('button', { name: /D1/ })[0]);
    expect(useApp.getState().selected?.mjd).toBe(60900);
  });

  it('says plainly when results may be incomplete', () => {
    render(<ObservationList result={{ ...result, complete: false, notes: ['SIA2 failed; TAP failed too, so these results may be incomplete.'] }} />);
    expect(screen.getByText('May be incomplete')).toBeInTheDocument();
    expect(screen.getByText(/TAP failed too/)).toBeInTheDocument();
  });
});
