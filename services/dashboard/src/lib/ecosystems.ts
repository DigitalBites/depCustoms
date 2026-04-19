/**
 * Master list of all package ecosystems the platform supports.
 * Used as a fallback when tenant entitlements return null (unrestricted).
 */
export const SUPPORTED_ECOSYSTEMS = ["npm", "pypi"] as const;
export type SupportedEcosystem = (typeof SUPPORTED_ECOSYSTEMS)[number];
