import app from "../dist/index.mjs";

export default async function handler(req: any, res: any) {
  return app(req, res);
}