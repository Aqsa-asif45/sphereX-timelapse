/** Shapes returned by the FastAPI backend (backend/app). */

export interface Target {
  slug: string;
  name: string;
  classification: string;
  kind: 'star' | 'brown dwarf' | 'variable star';
  look_for: 'motion' | 'brightness';
  lookup: string | null;
  ra: number | null;
  dec: number | null;
  epoch_mjd: number | null;
  position_source: string | null;
  pmra: number | null;
  pmdec: number | null;
  pm_source: string | null;
  in_gaia: boolean;
}

export interface Resolved {
  name: string;
  ra: number;
  dec: number;
  epoch_mjd: number;
  source: string;
  kind: string | null;
  classification?: string;
  slug?: string;
  pmra?: number | null;
  pmdec?: number | null;
  pm_source?: string | null;
}

export interface Observation {
  obs_id: string;
  release: string;
  collection: string;
  survey: string;
  week: string;
  large_slew: number;
  small_slew: number;
  detector: number;
  mjd: number;
  utc: string;
  lambda_min_um: number | null;
  lambda_max_um: number | null;
  access_url: string;
  cutout_capable: boolean;
  pipeline: string;
  version: string;
  processing_date: string;
  adapter: string;
  retrieved_utc: string;
}

export interface SearchResult {
  ra: number;
  dec: number;
  radius_deg: number;
  collections: string[];
  adapter: string;
  complete: boolean;
  count: number;
  by_release: Record<string, number>;
  observations: Observation[];
  errors: Record<string, string>;
  notes: string[];
  elapsed_s: number;
  retrieved_utc: string;
}

export interface FlagDef {
  name?: string;
  description?: string;
  category: 'bad' | 'artifact' | 'info';
}

export interface CutoutResponse {
  shape: [number, number];
  image_b64: string;
  flags_b64: string;
  variance_b64: string | null;
  bunit: string | null;
  variance_unit: string | null;
  mjd_avg: number | null;
  timesys: string | null;
  date_avg: string | null;
  target_pixel_0based: [number, number];
  target_pixel_original_1based: [number, number] | null;
  wavelength_um: number;
  bandwidth_um: number;
  spectral_units: string[];
  north_px: [number | null, number | null];
  east_px: [number | null, number | null];
  local_wcs: { x0: number; y0: number; ra0: number; dec0: number; cd_deg_per_px: [[number, number], [number, number]] };
  flags: { definitions: Record<string, FlagDef>; counts: Record<string, number>; bad_mask: number; compressed: boolean };
  stats: { median: number | null; sigma_mad: number | null; p1: number | null; p99_5: number | null; nan_pixels: number };
  header: Record<string, string | number>;
  hdus: { name: string; type: string }[];
  source_url: string;
  cutout_url: string;
  from_cache: boolean;
  size_deg: number;
  ra: number;
  dec: number;
}

/** A cutout decoded into typed arrays. Array row 0 is the bottom row (FITS convention). */
export interface Cutout extends Omit<CutoutResponse, 'image_b64' | 'flags_b64' | 'variance_b64'> {
  nx: number;
  ny: number;
  image: Float32Array;
  flagsArr: Int32Array;
  variance: Float32Array | null;
}
