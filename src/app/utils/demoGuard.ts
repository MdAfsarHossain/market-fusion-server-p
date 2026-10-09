import httpStatus from "http-status";
import ApiError from "../errors/ApiError";

// Requests a demo account may make even though they are not GETs.
//
// Only genuinely non-mutating endpoints belong here. /coupon/preview prices a
// cart against a code and writes nothing, so blocking it would break the
// checkout page for no benefit.
// Matched against req.originalUrl, not req.path: Express rewrites req.url
// inside a mounted router, so a path here would not see the module prefix.
const READ_ONLY_EXCEPTIONS = [
  { method: "POST", path: /\/coupon\/preview(?:[/?]|$)/ },
];

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export const DEMO_READ_ONLY_MESSAGE =
  "This is a read-only demo account, so nothing can be changed. Create a free account to try it for real.";

// The whole read-only guarantee lives here, called from auth() so it covers
// every authenticated route rather than relying on each one to remember.
// Hiding buttons in the UI is presentation; this is the rule.
export const assertDemoReadOnly = (
  isDemo: boolean,
  method: string,
  originalUrl: string,
) => {
  if (!isDemo) return;

  if (SAFE_METHODS.includes(method.toUpperCase())) return;

  const allowed = READ_ONLY_EXCEPTIONS.some(
    (exception) =>
      exception.method === method.toUpperCase() && exception.path.test(originalUrl),
  );

  if (allowed) return;

  throw new ApiError(httpStatus.FORBIDDEN, DEMO_READ_ONLY_MESSAGE);
};
