import type { Amount, BoxCandidate } from "@fleet-sdk/common";

import type { AssetId } from "./types";

export function validateToken(tokenId: AssetId, box: BoxCandidate<Amount>, index: number): boolean {
  const token = box.assets[index];
  return !token || token.tokenId === tokenId;
}
