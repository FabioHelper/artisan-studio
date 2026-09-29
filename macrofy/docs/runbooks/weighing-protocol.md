# Conferir com balança (opcional)

Para o dono, quando quiser. Você não precisa pesar nada para usar o Macrofy: aponte a câmera para o
prato e o resultado aparece. Pesar é só para conferir e para o app aprender com você
([ADR 0006](../decisions/0006-zero-setup-and-scale-checks.md)).

## Como conferir

1. Aponte a câmera para o prato e espere o resultado. Não pese antes: a estimativa precisa ser feita
   antes de você saber o peso, senão o erro não vale como teste.
2. Depois da estimativa, pese cada alimento na balança de cozinha (só a comida, sem o prato).
3. Na tela do resultado, abra "Conferir com balança" e digite os gramas de cada item. Se pesou só o
   prato todo, digite o total no campo "Ou o total do prato". Pode deixar em branco o que não pesou.
4. Se quiser comparar, digite as calorias que outro app mostrou. Elas servem só para comparar e nunca
   entram na calibração.
5. Toque em "Salvar conferência". O resultado passa a dizer "Calibrado com N conferências" e a
   próxima estimativa já usa o que o app aprendeu.

Quanto mais conferências, melhor. A tela "Precisão" mostra o erro de calorias e de massa com o
intervalo de 95% e compara o Macrofy com o outro app. Com menos de 5 conferências ela avisa que
precisa de mais conferências. Vale conferir em dias diferentes: o intervalo sorteia dias.

## Enviar as conferências

Em "Precisão", toque em "Exportar conferências" e compartilhe o arquivo (checks.json). Ele traz as
conferências, o manifesto e as previsões, prontos para o motor de avaliação do repositório, que
pontua o arquivo. As fotos ficam no aparelho; o arquivo só leva o sha256 de cada uma.

## Se quiser medir mais

Em "Ajustes / Corrigir" ficam as ferramentas antigas, todas opcionais: cadastrar o prato para uma
escala mais exata, o modo manual com toques e o fluxo "Pesar refeição" (manifesto do benchmark, que
`node bench/validate.mjs` confere). O que o app faz sem elas é o que vale.
