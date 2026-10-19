import { environment } from "../environments/environment";

const excludedShopCodes = new Set(
  environment.excludedShopCodes.map((code) => code.trim().toUpperCase())
);

export function isExcludedShopCode(shopCode: unknown): boolean {
  return excludedShopCodes.has(String(shopCode ?? "").trim().toUpperCase());
}
