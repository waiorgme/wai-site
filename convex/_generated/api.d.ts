/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_audit from "../admin/audit.js";
import type * as admin_claims from "../admin/claims.js";
import type * as admin_dataRequests from "../admin/dataRequests.js";
import type * as admin_guardians from "../admin/guardians.js";
import type * as admin_pipelineReviews from "../admin/pipelineReviews.js";
import type * as auth from "../auth.js";
import type * as certificates from "../certificates.js";
import type * as guardians from "../guardians.js";
import type * as http from "../http.js";
import type * as importedMembers from "../importedMembers.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_adminMask from "../lib/adminMask.js";
import type * as lib_age from "../lib/age.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_certificates from "../lib/certificates.js";
import type * as lib_claim from "../lib/claim.js";
import type * as lib_countries from "../lib/countries.js";
import type * as lib_guardianEmail from "../lib/guardianEmail.js";
import type * as lib_guardianToken from "../lib/guardianToken.js";
import type * as lib_joinValidation from "../lib/joinValidation.js";
import type * as lib_lifecycle from "../lib/lifecycle.js";
import type * as lib_memberLane from "../lib/memberLane.js";
import type * as lib_names from "../lib/names.js";
import type * as lib_pipeline from "../lib/pipeline.js";
import type * as lib_pipelineDecide from "../lib/pipelineDecide.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_profile from "../lib/profile.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_toggles from "../lib/toggles.js";
import type * as lib_turnstile from "../lib/turnstile.js";
import type * as members from "../members.js";
import type * as pipelineReviews from "../pipelineReviews.js";
import type * as rateLimit from "../rateLimit.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/audit": typeof admin_audit;
  "admin/claims": typeof admin_claims;
  "admin/dataRequests": typeof admin_dataRequests;
  "admin/guardians": typeof admin_guardians;
  "admin/pipelineReviews": typeof admin_pipelineReviews;
  auth: typeof auth;
  certificates: typeof certificates;
  guardians: typeof guardians;
  http: typeof http;
  importedMembers: typeof importedMembers;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/adminMask": typeof lib_adminMask;
  "lib/age": typeof lib_age;
  "lib/audit": typeof lib_audit;
  "lib/certificates": typeof lib_certificates;
  "lib/claim": typeof lib_claim;
  "lib/countries": typeof lib_countries;
  "lib/guardianEmail": typeof lib_guardianEmail;
  "lib/guardianToken": typeof lib_guardianToken;
  "lib/joinValidation": typeof lib_joinValidation;
  "lib/lifecycle": typeof lib_lifecycle;
  "lib/memberLane": typeof lib_memberLane;
  "lib/names": typeof lib_names;
  "lib/pipeline": typeof lib_pipeline;
  "lib/pipelineDecide": typeof lib_pipelineDecide;
  "lib/policy": typeof lib_policy;
  "lib/profile": typeof lib_profile;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/toggles": typeof lib_toggles;
  "lib/turnstile": typeof lib_turnstile;
  members: typeof members;
  pipelineReviews: typeof pipelineReviews;
  rateLimit: typeof rateLimit;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
