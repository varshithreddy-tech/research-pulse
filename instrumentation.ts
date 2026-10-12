// Second check at server start-up (e.g. a secret removed in Vercel after the build): refuse to serve.
import { assertRequiredSecrets } from "./lib/requiredSecrets";

export function register() {
  assertRequiredSecrets();
}
