import { loadCatalog } from '@node-arena/content';
import balance from '../../../../packages/content/data/balance.json' with { type: 'json' };

/** Catalog conversion keeps editor world units aligned with content's milli-units. */
export const MIN_BUILDING_DISTANCE = loadCatalog({ 'data/balance.json': balance }).balance.minBuildingDistance / 1000;
