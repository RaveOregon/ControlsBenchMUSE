// Example external campaign factory module for `scripts/host-portal.js --campaign-module`.
// The M10 live factory has the same shape around its M8 connector.
import { fixtureCampaignFactory } from "../../src/host/campaign-factory.ts";
export function createCampaignFactory() { return fixtureCampaignFactory(); }
