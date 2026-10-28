-- Dados de apoio de cada aviso enviado: o teto do bom dia (para o aviso de teto estourado à noite) e os ids das
-- notícias e das cobranças recorrentes já avisadas (para não repetir).
alter table public.notificacoes_enviadas add column dados jsonb;

comment on column public.notificacoes_enviadas.dados is 'Dados de apoio do aviso (ex.: {"teto": 95.5}, {"ids": [...]}); só a Edge Function usa.';
