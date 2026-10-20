#!/usr/bin/env node
/**
 * Gera o `web_password_hash` de uma pessoa para o registro de tenants.
 *
 *     node scripts/gerar-hash-senha.mjs 'a senha dela'
 *
 * A senha não é guardada em lugar nenhum — nem no repositório, nem no banco,
 * nem no registro. O que vai para o `tenants.json` é só este hash PBKDF2, e
 * dele não se volta para a senha.
 *
 * Rode com a senha entre aspas simples para o shell não interpretar símbolo, e
 * prefira apagar a linha do histórico depois (`history -d`), ou usar um espaço
 * no começo do comando se o seu shell ignora essas linhas.
 */

import { gerarHash } from "../apps/web/api/_auth.js";

const senha = process.argv[2];
if (!senha) {
  console.error("uso: node scripts/gerar-hash-senha.mjs 'a senha'");
  process.exit(1);
}
if (senha.length < 12) {
  console.error("senha curta: use pelo menos 12 caracteres — o painel fica exposto na internet");
  process.exit(1);
}

console.log(await gerarHash(senha));
