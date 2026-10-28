-- Contas existentes receberam Outros antes da paleta escura. A função de
-- categorias corrige cadastros futuros; esta migração corrige só a cor antiga.
update public.categorias set cor = '#8a8a9a'
where nome = 'Outros' and cor = '#64748b';
