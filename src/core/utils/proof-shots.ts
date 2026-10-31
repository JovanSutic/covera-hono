/**
 * The one place a shot's proof payload is assembled: its images for THIS
 * reservation, and its assets with the catalogue row renamed `asset_type`.
 *
 * Extracted from `inspectionsService.getById`'s detailed branch when the
 * reservation-scoped photo read landed. TWO readers now produce `ShotWithAssets`
 * — the inspection tree and `GET /reservations/{id}/photos` — and the host's photo
 * dialog renders whichever it was given, so the two must agree field for field.
 * Two copies of this mapping is how one of them silently stops carrying `images`.
 */
export const toAssetWithType = (asset: any) => {
  const { assetType, ...rest } = asset;
  return { ...rest, asset_type: assetType };
};

/**
 * Maps every shot to `{ ...shot, images, assets }`. Shots with no image are
 * KEPT — that is the inspection tree's existing contract, and dropping them here
 * would change a payload that is already deployed. A reader that wants only the
 * photographed shots filters afterwards (`reservationsService.getProofPhotos`).
 */
export function buildProofShots(shots: any[], images: any[]) {
  return shots.map((shot) => {
    const { shotAssets = [], ...shotData } = shot;

    return {
      ...shotData,
      images: images.filter((image) => image.shotId === shot.id),
      assets: shotAssets.map((pivot: { asset: any }) => toAssetWithType(pivot.asset)),
    };
  });
}
