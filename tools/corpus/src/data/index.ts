import type { Candidate } from "../types.js";
import { javaPool } from "./java.js";
import { kycPool } from "./kyc.js";
import { nonePool, retailPool } from "./retail.js";

export { jds } from "./jds.js";
export const candidates: Candidate[] = [
  ...javaPool,
  ...kycPool,
  ...retailPool,
  ...nonePool,
];
