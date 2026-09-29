# Teste de viabilidade no iPhone (para o dono)

Objetivo: descobrir se o iPhone 16e consegue rodar os modelos do Macrofy no Safari. Leva de 5 a 15
minutos e baixa algumas centenas de MB, então use o Wi-Fi. Spec: [SPEC-T-012](../specs/SPEC-T-012-browser-feasibility.md).

1. No Safari do iPhone, abra https://fabiohelper.github.io/artisan-studio/feasibility/
2. **Antes de tudo, apague os resultados salvos:** se a página já mostra resultados de uma rodada anterior, toque em **Apagar resultados salvos**. Sem isso, as etapas já concluídas antes são puladas e o teste novo não roda de verdade.
3. Toque em **Iniciar teste**. Não é preciso tirar foto: o teste usa uma imagem de exemplo.
4. Mantenha o Safari aberto e a tela ligada até aparecer "Pronto!" e o resultado (go ou no-go). A página recarrega sozinha entre as etapas para liberar memória: é normal.
5. Toque em **Copiar resultados**.
6. Cole o texto na conversa com o Claude.

Se a página recarregar ou o Safari fechar a aba no meio do teste:

- Abra o mesmo endereço de novo. A página mostra qual tentativa (modelo e tipo de execução) derrubou a aba.
- Ele continua sozinho (ou toque em **Continuar o teste**) com a próxima tentativa da mesma etapa: cada combinação de modelo, WebGPU ou WASM e precisão é testada uma única vez, e só a que derrubou a aba é pulada.
- No fim, toque em **Copiar resultados** e cole na conversa como acima. O resultado inclui as tentativas que derrubaram a aba, o espaço de armazenamento do Safari antes de cada etapa e, em cada falha, o nome do erro e o arquivo que estava sendo baixado. A profundidade é só informativa: o veredito depende da segmentação e dos nomes.

Dicas: feche outras abas e apps pesados antes; se aparecer erro de rede, tente de novo no Wi-Fi.
Opcional: escolha antes uma foto de um prato no campo de foto, em vez da imagem de exemplo.
Se quiser recomeçar do zero, toque em **Apagar resultados salvos**.
