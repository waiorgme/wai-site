import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Mounts the Convex Auth routes (magic-link verification, sign-out, etc.).
auth.addHttpRoutes(http);

export default http;
