import Campo from './Campo'

type Props = {
  /** Prefixo dos ids (o formulário de lançamento e o de dividir aparecem um de cada vez, mas com campos próprios) */
  id: string
  marcado: boolean
  aoMarcar: (marcado: boolean) => void
  nome: string
  aoMudarNome: (nome: string) => void
  /** Nomes já usados, sugeridos enquanto digita */
  sugestoes: string[]
  erro?: string
  /** Sem estes dois, não oferece marcar como empréstimo */
  emprestimo?: boolean
  aoMarcarEmprestimo?: (marcado: boolean) => void
}

/** "É de outra pessoa": tira o lançamento das minhas receitas e despesas e leva para a tela de Acertos */
export default function CampoTerceiro({
  id,
  marcado,
  aoMarcar,
  nome,
  aoMudarNome,
  sugestoes,
  erro,
  emprestimo,
  aoMarcarEmprestimo,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borda px-3.5 py-3 text-sm">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => aoMarcar(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primaria"
        />
        <span>
          <span className="block font-medium">É de outra pessoa</span>
          <span className="block text-texto-suave">
            Conta no saldo e na fatura, mas não nas minhas receitas e despesas. Aparece em Acertos.
          </span>
        </span>
      </label>
      {marcado && (
        <>
          <Campo
            id={`${id}-terceiro`}
            label="De quem"
            placeholder="Ex.: Mãe"
            required
            maxLength={40}
            list={`${id}-terceiros`}
            value={nome}
            onChange={(e) => aoMudarNome(e.target.value)}
            erro={erro}
          />
          <datalist id={`${id}-terceiros`}>
            {sugestoes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {aoMarcarEmprestimo && (
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={emprestimo ?? false}
                onChange={(e) => aoMarcarEmprestimo(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primaria"
              />
              <span>
                <span className="block font-medium">É empréstimo</span>
                <span className="block text-texto-suave">
                  Fica em aberto nos Acertos até ser devolvido, mesmo depois que o mês fecha.
                </span>
              </span>
            </label>
          )}
        </>
      )}
    </div>
  )
}
