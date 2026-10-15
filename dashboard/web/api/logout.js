/** POST /api/logout — apaga o cookie de sessão. */

import { cookieVazio } from "./_auth.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", cookieVazio());
  return res.status(200).json({ ok: true });
}
