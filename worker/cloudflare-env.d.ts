declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
