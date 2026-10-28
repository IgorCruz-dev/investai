-- Sincronização automática com a Pluggy (pg_cron) e o aviso de "Bom dia" com o saldo.

-- Marca as sincronizações feitas pelo agendamento: só elas viram notificação (a manual você já vê na tela)
alter table public.sync_log add column automatica boolean not null default false;

-- Mesma conta de saldo_em, mas para um usuário informado. A Edge Function notificar roda com service role
-- (sem auth.uid()), então só o service_role pode chamar.
create or replace function public.saldo_do_usuario(p_user uuid, p_dia date)
returns numeric
language sql
stable
set search_path to ''
as $$
  select
    coalesce((
        select sum(saldo_inicial) from public.contas
        where user_id = p_user and empresarial = false
      ), 0)
    + coalesce((
        select sum(case when t.forma = 'credito' then 0 when t.tipo = 'receita' then t.valor else -t.valor end)
        from public.transacoes t
        left join public.contas c on c.id = t.conta_id
        where t.user_id = p_user and t.data <= p_dia and coalesce(c.empresarial, false) = false
      ), 0)
    + coalesce((
        select sum(case when m.tipo = 'retirada' then m.valor else -m.valor end)
        from public.caixinha_movimentos m
        where m.user_id = p_user and m.data <= p_dia and m.transacao_id is null
      ), 0);
$$;

revoke all on function public.saldo_do_usuario(uuid, date) from public, anon, authenticated;
grant execute on function public.saldo_do_usuario(uuid, date) to service_role;
